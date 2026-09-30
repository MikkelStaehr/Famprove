"""The strength-session rule through the whole daily job (collect-intervals, collect-strength,
compute) on the in-memory PostgREST: idempotency, deletion + renumbering, moved sheet dates,
and WeightTraining never reaching cycling TSS."""

from collections.abc import Sequence
from datetime import UTC, date, datetime

import pytest

from conftest import (
    BLOK_11_SECTIONS,
    FIXED_TODAY,
    SYNTHETIC_BODYWEIGHT,
    SYNTHETIC_SHEET_ID,
    Call,
    FakeResponse,
    FakeSend,
    InMemoryPostgrest,
    build_workbook,
    raw_ride,
)
from training_load.cli import collect_intervals, collect_strength, compute
from training_load.config import GoogleSettings, IntervalsSettings
from training_load.sources.google_drive import GOOGLE_SHEET_MIME

K = 0.02
SINCE = date(2026, 1, 1)
RUN_AT = datetime(2026, 3, 15, 3, 0, tzinfo=UTC)
GOOGLE = GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={})
INTERVALS = IntervalsSettings(api_key="k", athlete_id="i1")
TABLES = ("activities", "strength_activities", "strength_sets", "strength_sessions", "daily_load")
# Synthetic blok 11 week 1 (ISO week of Mon 2026-02-02): session scores from the sheet formula.
SESSION_1_SCORE = 3 * 336.8 + 3 * 264.6 + 2 * 72.0 + 3 * 86.4
SESSION_2_SCORE = 3 * 90.7 + 3 * 307.2

RIDES = [
    raw_ride("r1", "2026-01-01T18:00:00", load=100),
    raw_ride("r2", "2026-02-05T07:00:00", load=60),
]
LIFTS = [
    raw_ride("g1", "2026-02-03T19:00:00", load=19, kind="WeightTraining"),
    raw_ride("g2", "2026-02-05T19:00:00", load=17, kind="WeightTraining"),
]


@pytest.fixture(autouse=True)
def fake_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(collect_strength, "access_token", lambda _info: "fake-token")


def drive(workbook: bytes) -> FakeSend:
    def handler(call: Call) -> FakeResponse:
        assert call.method == "GET", "Drive must only ever be read"
        if dict(call.params or []).get("fields") == "mimeType":
            return FakeResponse(body={"mimeType": GOOGLE_SHEET_MIME})
        return FakeResponse(raw=workbook)

    return FakeSend(handler=handler)


def daily_job(
    db: InMemoryPostgrest, body: Sequence[dict[str, object]], workbook: bytes | None = None
) -> None:
    collect_intervals.run(
        INTERVALS,
        send=FakeSend(FakeResponse(body=list(body))),
        db=db,
        since=SINCE,
        today=FIXED_TODAY,
    )
    collect_strength.run(
        GOOGLE,
        bodyweight=SYNTHETIC_BODYWEIGHT,
        send=drive(workbook if workbook is not None else build_workbook()),
        db=db,
    )
    compute.run(db, strength_k=K, today=FIXED_TODAY, computed_at=RUN_AT)


def snapshot(db: InMemoryPostgrest, tables: Sequence[str] = TABLES) -> dict[str, list[str]]:
    return {t: sorted(map(repr, db.tables.get(t, []))) for t in (*tables, "blocks")}


def week_sessions(db: InMemoryPostgrest, week_start: str) -> dict[object, object]:
    return {
        r["session"]: (r["activity_id"], r["date"], r["tss"])
        for r in db.tables["strength_sessions"]
        if r["week_start"] == week_start
    }


def test_running_collectors_and_compute_twice_gives_identical_rows(
    db: InMemoryPostgrest,
) -> None:
    daily_job(db, [*RIDES, *LIFTS])
    first = snapshot(db)
    daily_job(db, [*RIDES, *LIFTS])
    assert snapshot(db) == first
    assert all(first[t] for t in TABLES)  # every table was actually filled


def test_activity_deleted_inside_window_disappears_and_week_renumbers(
    db: InMemoryPostgrest,
) -> None:
    daily_job(db, [*RIDES, *LIFTS])
    assert week_sessions(db, "2026-02-02") == {
        1: ("g1", "2026-02-03", pytest.approx(SESSION_1_SCORE * K)),
        2: ("g2", "2026-02-05", pytest.approx(SESSION_2_SCORE * K)),
    }

    daily_job(db, [*RIDES, LIFTS[1]])  # g1 deleted on intervals.icu

    assert {r["id"] for r in db.tables["strength_activities"]} == {"g2"}
    assert week_sessions(db, "2026-02-02") == {
        1: ("g2", "2026-02-05", pytest.approx(SESSION_1_SCORE * K)),
        2: (None, None, 0.0),
    }
    days = {r["date"]: r for r in db.tables["daily_load"]}
    assert days["2026-02-03"]["strength_tss"] == 0.0
    assert days["2026-02-05"]["strength_tss"] == pytest.approx(SESSION_1_SCORE * K)


def test_moving_the_sheet_date_rows_within_the_week_changes_no_output(
    db: InMemoryPostgrest,
) -> None:
    daily_job(db, [*RIDES, *LIFTS])
    as_written = snapshot(db)

    (dates_1, rows_1), (dates_2, rows_2) = BLOK_11_SECTIONS
    moved = build_workbook(
        [
            ([d.replace(day=d.day + 1) for d in dates_1], rows_1),  # Mon -> Tue
            ([d.replace(day=d.day + 2) for d in dates_2], rows_2),  # Thu -> Sat
        ]
    )
    other = InMemoryPostgrest()
    daily_job(other, [*RIDES, *LIFTS], workbook=moved)
    assert snapshot(other) == as_written


def test_weight_training_load_never_reaches_cycling_tss(db: InMemoryPostgrest) -> None:
    daily_job(db, [*RIDES, *LIFTS])
    cycling = {r["date"]: r["cycling_tss"] for r in db.tables["daily_load"] if r["cycling_tss"]}
    assert cycling == {"2026-01-01": 100.0, "2026-02-05": 60.0}
    assert {r["id"] for r in db.tables["activities"]} == {"r1", "r2"}
