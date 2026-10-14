"""The intervals.icu calendar (answers round, user 2026-10-14): sources.intervals.parse_events,
db.planned_events, cli.collect_events.run_events, and the prognose's calendar week rule.
Synthetic only: the user's calendar held no events when this was built (2024-01 .. 2027-06),
so a real-data slice waits for the first planned ride."""

import logging
from datetime import UTC, date, datetime, timedelta

import pytest

from conftest import FakeResponse, FakeSend, InMemoryPostgrest
from training_load.cli.collect_events import (
    EventsRunSummary,
    EventsShapeError,
    run_events,
)
from training_load.config import IntervalsSettings
from training_load.db.planned_events import events_between
from training_load.domain.calendar import events_window
from training_load.domain.daily import build_daily_load
from training_load.domain.load import Decay
from training_load.domain.projection import CalendarRide, PlannedRide, ProjectedDay, project
from training_load.sources.intervals import parse_events

TODAY = date(2026, 10, 14)  # a Wednesday; the window starts Monday 12 Oct
SETTINGS = IntervalsSettings(api_key="secret-key", athlete_id="i123")
NOW = datetime(2026, 10, 14, 3, 0, tzinfo=UTC)


def event(
    event_id: int,
    day: str,
    *,
    category: str = "WORKOUT",
    kind: str | None = "Ride",
    load: object = 60,
) -> dict[str, object]:
    return {
        "id": event_id,
        "start_date_local": f"{day}T00:00:00",
        "category": category,
        "type": kind,
        "name": f"Event {event_id}",
        "icu_training_load": load,
    }


FIVE = [
    event(1, "2026-10-20", load=60),
    event(2, "2026-10-21", kind="VirtualRide", load=45),
    event(3, "2026-10-22", category="NOTE", kind=None, load=None),
    event(4, "2026-10-23", kind="WeightTraining", load=30),
    event(5, "2026-10-24", load=None),
]


def run(db: InMemoryPostgrest, body: list[dict[str, object]]) -> EventsRunSummary:
    return run_events(
        SETTINGS, send=FakeSend(FakeResponse(body=body)), db=db, today=TODAY, now=lambda: NOW
    )


def ids(db: InMemoryPostgrest) -> list[int]:
    return sorted(int(str(r["id"])) for r in db.tables["planned_events"])


# --- parse --------------------------------------------------------------------------------------


def test_parse_keeps_every_event_and_marks_planned_rides() -> None:
    parsed = parse_events(FIVE)
    assert [e.id for e in parsed.events] == [1, 2, 3, 4, 5]
    assert [e.is_planned_ride for e in parsed.events] == [True, True, False, False, True]
    assert parsed.events[0].date == date(2026, 10, 20) and parsed.events[0].load == 60.0
    assert parsed.rides_without_load == 1 and parsed.skipped == 0


@pytest.mark.parametrize("load", [None, 0, -5, "60", True])
def test_a_missing_zero_or_text_load_is_none_never_0(load: object) -> None:
    (only,) = parse_events([event(1, "2026-10-20", load=load)]).events
    assert only.load is None


def test_junk_without_id_category_or_date_is_skipped_and_counted() -> None:
    junk: list[dict[str, object]] = [
        {"category": "WORKOUT", "start_date_local": "2026-10-20T00:00:00"},  # no id
        {"id": 9, "start_date_local": "2026-10-20T00:00:00"},  # no category
        {"id": 10, "category": "WORKOUT", "start_date_local": "20 Oct"},  # unreadable date
        event(11, "2026-10-20"),
    ]
    parsed = parse_events(junk)
    assert [e.id for e in parsed.events] == [11] and parsed.skipped == 3


# --- mirror (1b) --------------------------------------------------------------------------------


def test_the_window_covers_this_week_through_the_week_of_today_plus_56_days() -> None:
    assert events_window(TODAY) == (date(2026, 10, 12), date(2026, 12, 13))


def test_run_stores_every_event_raw_idempotently_and_mirrors_deletions_in_the_window(
    db: InMemoryPostgrest, caplog: pytest.LogCaptureFixture
) -> None:
    db.tables["planned_events"] = [  # before the window: never touched
        {"id": 99, "date": "2026-10-01", "category": "WORKOUT", "type": "Ride", "name": "Old",
         "load": 50.0, "raw": {}, "fetched_at": NOW.isoformat()},
    ]  # fmt: skip
    with caplog.at_level(logging.WARNING):
        run(db, FIVE)
    assert ids(db) == [1, 2, 3, 4, 5, 99]
    assert next(r for r in db.tables["planned_events"] if r["id"] == 1)["raw"] == FIVE[0]
    assert "1 planned rides have no load" in caplog.text
    assert "Event 5" not in caplog.text  # counts only: the Actions logs are public

    run(db, FIVE)
    assert len(db.tables["planned_events"]) == 6

    summary = run(db, [e for e in FIVE if e["id"] != 2])
    assert ids(db) == [1, 3, 4, 5, 99]
    assert summary == EventsRunSummary(
        fetched=4, upserted=4, deleted=1, skipped=0, planned_rides=2, rides_without_load=1
    )


def test_the_fetch_asks_for_the_window_with_a_day_of_margin(db: InMemoryPostgrest) -> None:
    send = FakeSend(FakeResponse(body=[]))
    run_events(SETTINGS, send=send, db=db, today=TODAY, now=lambda: NOW)
    assert send.calls[0].url == "https://intervals.icu/api/v1/athlete/i123/events"
    assert send.calls[0].params == [("oldest", "2026-10-11"), ("newest", "2026-12-14")]


def test_mostly_unreadable_calendar_fails_the_run_after_writing_the_readable_ones(
    db: InMemoryPostgrest,
) -> None:
    run(db, [event(8, "2026-10-21")])  # stored, in the window, absent from the next response
    body: list[dict[str, object]] = [{"id": i} for i in range(3)]
    body.append(event(7, "2026-10-20"))
    with pytest.raises(EventsShapeError):
        run(db, body)
    assert ids(db) == [7, 8]  # a changed shape never wipes the stored calendar


def test_compute_reads_the_window_back(db: InMemoryPostgrest) -> None:
    run(db, FIVE)
    rides = [e for e in events_between(db, TODAY, TODAY + timedelta(days=56)) if e.is_planned_ride]
    assert [(e.id, e.load) for e in rides] == [(1, 60.0), (2, 45.0), (5, None)]


# --- the prognose's week rule (1c, 1d, 1e) ------------------------------------------------------

HISTORY = build_daily_load(
    {TODAY - timedelta(days=d): 50.0 for d in (1, 3, 6, 8, 10, 13, 15, 17, 20, 22, 24, 27)},
    {},
    start=date(2026, 1, 1),
    end=TODAY,
    decay=Decay.EXPONENTIAL,
)
HAND_RIDE = PlannedRide(date(2026, 10, 21), "Hand", [{"minutes": 60, "pct_ftp": 65}])


def prognose(
    calendar: list[CalendarRide], rides: list[PlannedRide] | None = None
) -> dict[date, ProjectedDay]:
    days = project(
        HISTORY,
        [],
        [],
        rides or [],
        today=TODAY,
        strength_k=0.035,
        decay=Decay.EXPONENTIAL,
        typical_rides=12,
        calendar=calendar,
    )
    return {d.date: d for d in days}


def test_a_calendar_week_uses_only_its_rides_and_0_on_its_other_days() -> None:
    days = prognose([CalendarRide(date(2026, 10, 20), "Z2", 60.0)], [HAND_RIDE])
    week = [days[date(2026, 10, 19) + timedelta(days=i)] for i in range(7)]
    assert [d.cycling_tss for d in week] == [0.0, 60.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    assert {d.basis["cycling"] for d in week} == {"calendar"}
    assert days[date(2026, 10, 21)].basis["rides_ignored"]  # the hand-filled ride lost
    assert days[date(2026, 10, 20)].basis["calendar_rides"] == 1


def test_a_week_without_calendar_rides_is_unchanged() -> None:
    before = prognose([])
    after = prognose([CalendarRide(date(2026, 10, 20), "Z2", 60.0)])
    other_weeks = [d for d in before if not date(2026, 10, 19) <= d <= date(2026, 10, 25)]
    assert other_weeks and all(
        after[d].cycling_tss == before[d].cycling_tss
        and after[d].basis["cycling"] == before[d].basis["cycling"]
        for d in other_weeks
    )
    assert before[date(2026, 10, 15)].basis["cycling"] == "typical_week"  # this week: no event


def test_a_ride_without_a_load_gives_its_day_the_typical_value_never_0() -> None:
    typical = prognose([])[date(2026, 10, 22)].cycling_tss
    day = prognose([CalendarRide(date(2026, 10, 22), "?", None)])[date(2026, 10, 22)]
    assert day.cycling_tss == typical and typical > 0
    assert day.basis["fallback"] == "typical_week"
    assert day.basis["events"] == [
        {"name": "?", "tss": None, "reason": "ingen belastning i intervals.icu"}
    ]
    assert day.basis["calendar_no_load"] == 1


def test_several_rides_on_one_day_add_up() -> None:
    days = prognose(
        [CalendarRide(date(2026, 10, 20), "AM", 40.0), CalendarRide(date(2026, 10, 20), "PM", 25.0)]
    )
    assert days[date(2026, 10, 20)].cycling_tss == 65.0
    assert days[date(2026, 10, 20)].basis["calendar_rides"] == 2


def test_a_mixed_day_keeps_the_known_load_and_adds_the_typical_value_for_the_unknown_ride() -> None:
    typical = prognose([])[date(2026, 10, 22)].cycling_tss
    day = prognose(
        [
            CalendarRide(date(2026, 10, 22), "Known", 40.0),
            CalendarRide(date(2026, 10, 22), "?", None),
        ]
    )[date(2026, 10, 22)]
    assert day.cycling_tss == 40.0 + typical and day.basis["fallback"] == "typical_week"


def test_a_ride_today_marks_this_week_but_adds_no_prognose_load() -> None:
    days = prognose([CalendarRide(TODAY, "Today", 70.0)])
    rest_of_week = [days[TODAY + timedelta(days=i)] for i in range(1, 5)]  # Thu .. Sun
    assert [d.cycling_tss for d in rest_of_week] == [0.0, 0.0, 0.0, 0.0]
    assert {d.basis["cycling"] for d in rest_of_week} == {"calendar"}
    assert rest_of_week[0].basis["calendar_rides"] == 0  # today's ride is not a prognose day
    assert rest_of_week[0].basis["calendar_weeks"] == 1


def test_a_ride_after_the_horizon_marks_the_last_week() -> None:
    days = prognose([CalendarRide(date(2026, 12, 11), "After", 80.0)])  # horizon ends 9 Dec
    last_week = [days[date(2026, 12, 7) + timedelta(days=i)] for i in range(3)]
    assert [d.cycling_tss for d in last_week] == [0.0, 0.0, 0.0]
    assert {d.basis["cycling"] for d in last_week} == {"calendar"}
    assert days[date(2026, 12, 4)].basis["cycling"] == "typical_week"  # the week before


def test_an_infinite_or_nan_load_is_missing() -> None:
    parsed = parse_events(
        [event(1, "2026-10-20", load=float("nan")), event(2, "2026-10-21", load=float("inf"))]
    )
    assert [e.load for e in parsed.events] == [None, None]
