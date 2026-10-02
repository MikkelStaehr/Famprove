"""The daily.yml gate (.github/scripts/gate.py): one collect-and-compute per slot, whether the
droplet's dispatch or GitHub's (delayed) schedule comes first; only finished runs decide; it
fails open (a duplicate is harmless, a missed slot is not)."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from http.client import IncompleteRead

import pytest
from gate import (
    POLL_SECONDS,
    WAIT_LIMIT,
    Decision,
    Job,
    OtherRun,
    outcome,
    resolve,
    slot_from_cron,
    slot_from_input,
    slot_start,
)

SUMMER = datetime(2026, 10, 2, 3, 0, tzinfo=UTC)  # 05:00 CEST
WINTER = datetime(2026, 12, 2, 4, 0, tzinfo=UTC)  # 05:00 CET
OK = Job("completed", "success")
RUNNING = Job("in_progress", None)
FAILED = Job("completed", "failure")


class Clock:
    """now()/sleep() for resolve: sleeping moves the clock, no real waiting."""

    def __init__(self, start: datetime) -> None:
        self.t = start
        self.slept: list[float] = []

    def now(self) -> datetime:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.t += timedelta(seconds=seconds)


def fetches(*answers: list[OtherRun] | Exception) -> Callable[[datetime], list[OtherRun]]:
    """Each call returns (or raises) the next answer; the last one repeats."""
    queue = list(answers)
    seen: list[datetime] = []

    def fetch(since: datetime) -> list[OtherRun]:
        seen.append(since)
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(answer, Exception):
            raise answer
        return answer

    return fetch


def decide(
    event: str, trigger: str, *answers: list[OtherRun] | Exception
) -> tuple[Decision, Clock]:
    clock = Clock(SUMMER)
    schedule, slot = (trigger, "") if event == "schedule" else ("", trigger)
    decision = resolve(event, schedule, slot, clock.now, fetches(*answers), clock.sleep)
    return decision, clock


@pytest.mark.parametrize(
    ("cron", "now", "slot"),
    [
        ("7 3 * * *", SUMMER, 5),
        ("37 4 * * *", SUMMER, None),  # the CET twin in summer
        ("37 4 * * *", WINTER, 5),
        ("7 3 * * *", WINTER, None),
        ("7 10 * * *", SUMMER, 12),
        ("37 11 * * *", WINTER, 12),
        ("7 18 * * *", SUMMER, 20),
        ("37 19 * * *", WINTER, 20),
    ],
)
def test_slot_from_cron(cron: str, now: datetime, slot: int | None) -> None:
    assert slot_from_cron(cron, now) == slot


def test_the_slot_input_is_exactly_05_12_or_20() -> None:
    assert [slot_from_input(v) for v in ("05", "12", "20")] == [5, 12, 20]
    for bad in ("5", "005", " 05", "05\n", "06", "x", "-5", chr(0x660) + chr(0x665)):
        with pytest.raises(ValueError, match="slot must be"):
            slot_from_input(bad)


def test_slot_start_handles_early_calls_and_delays_past_midnight() -> None:
    early = datetime(2026, 10, 2, 2, 58, tzinfo=UTC)  # 04:58 CEST, the droplet 2 min early
    assert slot_start(5, early).isoformat() == "2026-10-02T05:00:00+02:00"
    delayed = datetime(2026, 10, 1, 22, 23, tzinfo=UTC)  # 00:23 CEST on 2 Oct: yesterday's 20
    assert slot_start(20, delayed).isoformat() == "2026-10-01T20:00:00+02:00"
    same_day = datetime(2026, 10, 2, 9, 45, tzinfo=UTC)  # 11:45: the 05 slot, 6 h late
    assert slot_start(5, same_day).isoformat() == "2026-10-02T05:00:00+02:00"


@pytest.mark.parametrize(
    ("work", "state"),
    [
        (OK, "served"),
        (RUNNING, "pending"),
        (Job("queued", None), "pending"),
        (Job("waiting", None), "pending"),
        (FAILED, "open"),  # a failed run never serves
        (Job("completed", "skipped"), "open"),  # its gate said skip (or the DST twin)
        (Job("completed", "cancelled"), "open"),
        (Job("completed", "timed_out"), "open"),
        (None, "open"),  # not listed yet / its gate failed
    ],
)
def test_outcome(work: Job | None, state: str) -> None:
    assert outcome(OtherRun(1, work)) == state


def test_dispatch_first_then_the_delayed_schedule_skips() -> None:
    first, _ = decide("workflow_dispatch", "05", [])
    assert first.run and "not served" in first.reason
    second, clock = decide("schedule", "7 3 * * *", [OtherRun(101, OK)])
    assert not second.run and "run 101" in second.reason and clock.slept == []


def test_the_window_starts_30_minutes_before_the_slot() -> None:
    seen: list[datetime] = []

    def fetch(since: datetime) -> list[OtherRun]:
        seen.append(since)
        return []

    resolve("workflow_dispatch", "", "05", lambda: SUMMER, fetch, lambda _: None)
    assert [s.isoformat() for s in seen] == ["2026-10-02T04:30:00+02:00"]


def test_a_running_run_is_waited_for_and_its_failure_lets_this_run_go() -> None:
    decision, clock = decide("schedule", "7 3 * * *", [OtherRun(7, RUNNING)], [OtherRun(7, FAILED)])
    assert decision.run and not decision.warning and clock.slept == [POLL_SECONDS]


def test_a_running_run_that_succeeds_serves_the_slot() -> None:
    decision, _ = decide("workflow_dispatch", "05", [OtherRun(7, RUNNING)], [OtherRun(7, OK)])
    assert not decision.run and "run 7" in decision.reason


def test_a_wait_that_never_ends_fails_open_with_a_warning() -> None:
    decision, clock = decide("schedule", "7 3 * * *", [OtherRun(7, Job("queued", None))])
    assert decision.run and decision.warning and "still waiting" in decision.reason
    assert sum(clock.slept) >= WAIT_LIMIT.total_seconds()


def test_unreadable_runs_are_retried_then_fail_open() -> None:
    flaky, clock = decide("schedule", "7 3 * * *", IncompleteRead(b""), [OtherRun(1, OK)])
    assert not flaky.run and clock.slept == [5]  # one retry, then served
    down, clock = decide("schedule", "7 3 * * *", OSError("503"))
    assert down.run and down.warning and "unreadable" in down.reason and clock.slept == [5, 15]


def test_manual_runs_always_run_and_the_dst_twin_never_does() -> None:
    manual, _ = decide("workflow_dispatch", "", [OtherRun(1, OK)])
    assert manual.run  # e.g. a backfill
    twin, _ = decide("schedule", "37 4 * * *", [])
    assert not twin.run and "twin" in twin.reason
    with pytest.raises(ValueError, match="unexpected event"):
        resolve("push", "", "", lambda: SUMMER, fetches([]), lambda _: None)
    with pytest.raises(ValueError, match="slot must be"):
        decide("workflow_dispatch", "5", [])
