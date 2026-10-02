"""daily.yml gate: collect-and-compute runs once per slot (05, 12, 20 Copenhagen).

Triggers (user, 2026-10-02):
- the droplet's workflow_dispatch with input slot=05|12|20 (primary, on time);
- GitHub's schedule (backup, best-effort: both DST twins are scheduled; the one whose UTC hour
  + today's Copenhagen offset is a slot counts, the other is skipped);
- a manual workflow_dispatch without slot (e.g. a backfill): always runs.

A slot is served when another run of this workflow, created since the slot's start minus
SLOT_MARGIN, has a successful collect-and-compute; then this run skips. Only finished jobs
decide: while another run's collect-and-compute is queued or running, the gate waits for it
(POLL_SECONDS, up to WAIT_LIMIT), so a run that fails after starting never takes the slot from
the backup. A failed, skipped or cancelled run never serves a slot.

Fail open: if the runs can't be read (after RETRIES) or the wait times out, the gate runs. A
duplicate run is harmless (every step is idempotent and the job's concurrency group serializes
runs); a missed slot is not.

A run more than an hour before its slot hour belongs to yesterday's slot (a schedule delayed past
midnight). The Copenhagen offset is read when the gate runs, so a schedule delayed hours past a
DST switch can map to the wrong twin (rare; the droplet is the primary trigger).

Standard library only, Python 3.12 (the runner's python3; CI byte-compiles it with that version).
Tests: python/tests/test_gate.py.
"""

import http.client
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

CPH = ZoneInfo("Europe/Copenhagen")
SLOTS = {"05": 5, "12": 12, "20": 20}
SLOT_MARGIN = timedelta(minutes=30)  # a droplet call a few minutes early still counts
POLL_SECONDS = 30
WAIT_LIMIT = timedelta(minutes=15)
RETRIES = (5, 15)  # seconds to wait before each retry of a failed API read
WORKFLOW = "daily.yml"
WORK_JOB = "collect-and-compute"


@dataclass(frozen=True)
class Job:
    status: str  # queued | in_progress | completed | waiting | pending | requested
    conclusion: str | None  # success | failure | skipped | cancelled | ... (None until completed)


@dataclass(frozen=True)
class OtherRun:
    run_id: int
    work: Job | None  # this run's collect-and-compute job (None: not listed yet)


@dataclass(frozen=True)
class Decision:
    run: bool
    reason: str
    warning: bool = False  # failed open: shown as a ::warning:: annotation


def slot_from_cron(cron: str, now: datetime) -> int | None:
    """The Copenhagen slot a scheduled cron stands for today, or None for the DST twin."""
    utc_hour = int(cron.split()[1])
    offset = now.astimezone(CPH).utcoffset()
    assert offset is not None  # a ZoneInfo datetime always has one
    local_hour = (utc_hour + int(offset.total_seconds() // 3600)) % 24
    return local_hour if local_hour in SLOTS.values() else None


def slot_from_input(value: str) -> int:
    """The droplet's slot input: exactly "05", "12" or "20". Anything else is an error."""
    if value not in SLOTS:
        raise ValueError(f"slot must be one of 05, 12, 20, got {value!r}")
    return SLOTS[value]


def slot_start(slot: int, now: datetime) -> datetime:
    """The slot's start in Copenhagen; more than an hour before the slot hour means yesterday's."""
    local = now.astimezone(CPH)
    day = local.date()
    if local.hour < slot - 1:
        day -= timedelta(days=1)
    return datetime(day.year, day.month, day.day, slot, tzinfo=CPH)


def outcome(run: OtherRun) -> str:
    """served: its collect-and-compute succeeded; pending: it is queued or running (wait);
    open: anything else (failed, skipped, cancelled, not listed) never serves the slot."""
    work = run.work
    if work is None:
        return "open"
    if work.status != "completed":
        return "pending"
    return "served" if work.conclusion == "success" else "open"


def slot_of(event: str, schedule: str, slot_input: str, now: datetime) -> int | None:
    """The slot this run stands for; None = no slot lookup (manual run or the DST twin)."""
    if event == "workflow_dispatch":
        return slot_from_input(slot_input) if slot_input else None
    if event == "schedule":
        return slot_from_cron(schedule, now)
    raise ValueError(f"unexpected event {event!r}")


def resolve(
    event: str,
    schedule: str,
    slot_input: str,
    now: Callable[[], datetime],
    fetch: Callable[[datetime], list[OtherRun]],
    sleep: Callable[[float], None],
) -> Decision:
    """``fetch(since)``: the other runs of this workflow created since ``since``."""
    if event == "workflow_dispatch" and not slot_input:
        return Decision(True, "manual dispatch without slot: always runs")
    start = now()
    slot = slot_of(event, schedule, slot_input, start)
    if slot is None:
        return Decision(False, f"cron {schedule!r} is the other DST twin today")
    since = slot_start(slot, start) - SLOT_MARGIN
    label = f"slot {slot:02d} of {(since + SLOT_MARGIN).date().isoformat()}"
    while True:
        others = _fetch_with_retries(fetch, since, sleep)
        if others is None:
            return Decision(True, f"{label}: other runs unreadable, running anyway", warning=True)
        states = {r.run_id: outcome(r) for r in others}
        served = [run_id for run_id, s in states.items() if s == "served"]
        if served:
            return Decision(False, f"{label} is already served by run {served[0]}")
        if "pending" not in states.values():
            return Decision(True, f"{label} is not served yet")
        if now() - start >= WAIT_LIMIT:
            waited = f"still waiting after {WAIT_LIMIT}, running anyway"
            return Decision(True, f"{label}: {waited}", warning=True)
        sleep(POLL_SECONDS)


def _fetch_with_retries(
    fetch: Callable[[datetime], list[OtherRun]], since: datetime, sleep: Callable[[float], None]
) -> list[OtherRun] | None:
    for pause in (*RETRIES, None):
        try:
            return fetch(since)
        # urllib errors are OSErrors, a truncated response an HTTPException, bad JSON a ValueError
        except (OSError, http.client.HTTPException, ValueError) as error:
            print(f"gate: reading runs failed ({type(error).__name__})")
            if pause is None:
                return None
            sleep(pause)
    return None


# --- GitHub API (the job's own GITHUB_TOKEN, actions: read) --------------------------------


def _get(url: str, token: str) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if not isinstance(body, dict):
        raise ValueError("GitHub API: expected a JSON object")
    return body


def _work_job(jobs: list[object]) -> Job | None:
    for j in jobs:
        if isinstance(j, dict) and j.get("name") == WORK_JOB:
            status, conclusion = j.get("status"), j.get("conclusion")
            if isinstance(status, str) and (conclusion is None or isinstance(conclusion, str)):
                return Job(status, conclusion)
    return None


def github_fetch(repo: str, token: str, own_run_id: int) -> Callable[[datetime], list[OtherRun]]:
    def fetch(since: datetime) -> list[OtherRun]:
        created = urllib.parse.quote(f">={since.astimezone(UTC):%Y-%m-%dT%H:%M:%SZ}")
        base = f"https://api.github.com/repos/{repo}/actions"
        listing = _get(f"{base}/workflows/{WORKFLOW}/runs?created={created}&per_page=50", token)
        runs = listing.get("workflow_runs")
        out: list[OtherRun] = []
        for r in runs if isinstance(runs, list) else []:
            run_id = r.get("id") if isinstance(r, dict) else None
            if not isinstance(run_id, int) or run_id == own_run_id:
                continue
            jobs = _get(f"{base}/runs/{run_id}/jobs", token).get("jobs")
            out.append(OtherRun(run_id, _work_job(jobs if isinstance(jobs, list) else [])))
        return out

    return fetch


def main() -> int:
    event = os.environ["EVENT"]
    schedule = os.environ.get("SCHEDULE", "")
    slot_input = os.environ.get("SLOT", "")
    fetch = github_fetch(os.environ["REPO"], os.environ["GH_TOKEN"], int(os.environ["RUN_ID"]))
    decision = resolve(event, schedule, slot_input, lambda: datetime.now(UTC), fetch, time.sleep)
    run = str(decision.run).lower()
    trigger = schedule or slot_input or "-"
    if decision.warning:
        print(f"::warning::daily gate failed open: {decision.reason}")
    print(f"{event} {trigger}: run={run} ({decision.reason})")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"run={run}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
