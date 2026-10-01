"""Contract: the daily_projection rows Python writes are the web parser's fixture (CLAUDE.md).

web/tests/fixtures/daily_projection.json is the real producer's output (domain.projection +
db.daily_projection.to_row) on synthetic data; web/tests/rows.test.ts parses every row of it.
When the producer changes, regenerate it:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_projection.py
Edge cases kept in it: a plan day without a band, a recent day with a band, a session with no
day left this week, a plan session with unscored sets, one with no kg at all, a recent session
without recent weeks, and an unreadable planned ride.
"""

import json
import os
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from training_load.db.daily_projection import DailyProjectionRow, to_row
from training_load.domain.daily import build_daily_load
from training_load.domain.load import Decay
from training_load.domain.projection import PlannedRide, project
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet

MakeSet = Callable[..., StrengthSet]
FIXTURE = (
    Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "daily_projection.json"
)
TODAY = date(2026, 10, 3)  # Saturday of ISO week 40: two of its sessions have no day left
W40, W41 = date(2026, 9, 28), date(2026, 10, 5)
RUN_AT = datetime(2026, 10, 3, 3, 0, tzinfo=UTC)


def done(week_start: date, tss: float) -> StrengthSession:
    day = week_start + timedelta(days=1)
    return StrengthSession(
        week_start, 1, "s", "Program - blok 11", 5, f"i{day}", day, "Styrke", 3600, tss
    )


def producer_rows(make_set: MakeSet) -> list[DailyProjectionRow]:
    def unscorable(week: date, session: int) -> StrengthSet:
        return make_set(
            week_start=week,
            week=2,
            session=session,
            sheet_row=40 + session,
            type="BACK",
            name="New exercise",
            logged_kg=None,
            kg=0.0,
            score=0.0,
            prescribed="RPE 7",
        )

    sets = [
        *(make_set(week_start=W40, week=1, session=n, sheet_row=n) for n in (1, 2, 3)),
        make_set(week_start=W41, week=2, session=1, sheet_row=1),
        unscorable(W41, 1),  # session 1: scored, with 1 unscored set
        make_set(week_start=W41, week=2, session=2, sheet_row=2),
        unscorable(W41, 3),  # session 3: no kg for any set
    ]
    history = build_daily_load(
        {TODAY - timedelta(days=2 + 7 * i): 60.0 for i in range(4)},
        {},
        start=date(2026, 1, 1),
        end=TODAY,
        decay=Decay.EXPONENTIAL,
    )
    rides = [PlannedRide(date(2026, 10, 8), "Broken", [{"minutes": "x", "pct_ftp": 100}])]
    recent = [
        done(date(2026, 9, 7), 40.0),
        done(date(2026, 9, 14), 50.0),
        done(W40 - timedelta(7), 60.0),
    ]

    def run(sessions: list[StrengthSession]) -> list[DailyProjectionRow]:
        days = project(
            history, sessions, sets, rides, strength_k=0.1, today=TODAY, decay=Decay.EXPONENTIAL
        )
        return [to_row(d, computed_at=RUN_AT) for d in days]

    with_history = [r for r in run(recent) if r["date"] <= "2026-10-14"]
    without = next(
        r
        for r in run([])
        if r["strength_method"] == "recent" and r["strength_tss"] == 0.0 and r["basis"]["strength"]
    )
    return [*with_history, without]


def test_the_web_fixture_is_pythons_current_output(make_set: MakeSet) -> None:
    rows: object = json.loads(json.dumps(producer_rows(make_set)))  # as PostgREST returns JSON
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8", newline="\n")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/daily_projection.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_projection.py"
    )


def test_the_fixture_keeps_its_edge_cases(make_set: MakeSet) -> None:
    rows = producer_rows(make_set)
    entries = [
        e
        for r in rows
        for e in (r["basis"]["strength"] if isinstance(r["basis"]["strength"], list) else [])
        if isinstance(e, dict)
    ]
    reasons = {e["reason"] for e in entries if "reason" in e}
    assert reasons == {
        "no day left this week",
        "no kg for any set in the plan",
        "no recent weeks to average",
    }
    assert any(e["method"] == "plan" and e.get("unscored") == 1 and e["tss"] for e in entries)
    assert any(e["method"] == "recent" and "tss_low" in e for e in entries)
    assert {r["strength_method"] for r in rows} == {"plan", "recent"}
    assert any(r["ctl_low"] is None for r in rows) and any(r["ctl_low"] is not None for r in rows)
