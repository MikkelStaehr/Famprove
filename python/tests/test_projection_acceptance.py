"""domain.projection: tester's acceptance checks beyond test_projection.py (criteria 2-4)."""

import math
from collections.abc import Callable
from datetime import date, timedelta

import pytest

from training_load.domain.daily import DailyLoad, build_daily_load
from training_load.domain.load import Decay
from training_load.domain.projection import (
    HORIZON_DAYS,
    PlannedRide,
    ProjectedDay,
    project,
)
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet

MakeSet = Callable[..., StrengthSet]
WEEK_40 = date(2026, 9, 28)  # Monday


def history(today: date, cycling: dict[date, float] | None = None) -> list[DailyLoad]:
    return build_daily_load(
        cycling or {}, {}, start=date(2026, 1, 1), end=today, decay=Decay.EXPONENTIAL
    )


def entries(day: ProjectedDay, key: str) -> list[dict[str, object]]:
    value = day.basis[key]
    assert isinstance(value, list)
    return [e for e in value if isinstance(e, dict)]


def done(week_start: date, n: int, day: date, tss: float = 50.0) -> StrengthSession:
    return StrengthSession(
        week_start, n, "s", "Program - blok 12", 1, f"i{day}{n}", day, "Styrke", 3600, tss
    )


def test_projection_has_56_consecutive_days_from_tomorrow() -> None:
    today = date(2026, 9, 30)
    days = project(history(today), [], [], [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL)
    assert len(days) == HORIZON_DAYS == 56
    assert [d.date for d in days] == [today + timedelta(days=i) for i in range(1, 57)]


def test_zero_load_decays_ctl_and_atl_from_todays_row_on_every_day() -> None:
    today = date(2026, 9, 30)
    days = history(today, {date(2026, 7, 1): 500.0, date(2026, 8, 15): 300.0})
    seed = days[-1]
    assert seed.ctl > 1 and seed.atl > 0  # a non-trivial seed
    projected = project(days, [], [], [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL)
    assert all(p.cycling_tss == 0 and p.strength_tss == 0 for p in projected)
    for i, p in enumerate(projected, start=1):
        assert p.ctl == pytest.approx(seed.ctl * math.exp(-i / 42), abs=1e-9)
        assert p.atl == pytest.approx(seed.atl * math.exp(-i / 7), abs=1e-9)
        assert p.tsb == pytest.approx(p.ctl - p.atl, abs=1e-9)


def test_day_one_follows_the_recurrence_from_todays_row_with_load() -> None:
    today = date(2026, 9, 30)
    thursdays = {today - timedelta(days=6 + 7 * i): 80.0 for i in range(4)}
    days = history(today, thursdays)
    seed = days[-1]
    first = project(days, [], [], [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL)[0]
    assert first.date == date(2026, 10, 1) and first.cycling_tss == pytest.approx(80.0)
    w42, w7 = math.exp(-1 / 42), math.exp(-1 / 7)
    assert first.ctl == pytest.approx(seed.ctl * w42 + 80.0 * (1 - w42), abs=1e-9)
    assert first.atl == pytest.approx(seed.atl * w7 + 80.0 * (1 - w7), abs=1e-9)
    assert first.tsb == pytest.approx(first.ctl - first.atl, abs=1e-9)


@pytest.mark.parametrize(
    "steps",
    [
        [{"minutes": "60", "pct_ftp": 100}],  # number as text
        [{"minutes": 60, "pct_ftp": "95,5"}],  # comma decimal as text
        [{"minutes": 60}],  # pct_ftp missing
        [{"minutes": None, "pct_ftp": 100}],  # blank
        [],  # empty list
        None,  # no steps at all
        "junk",
    ],
)
def test_an_unreadable_ride_is_listed_with_a_reason_and_the_typical_day_stands(
    steps: object,
) -> None:
    today = date(2026, 9, 30)
    thursdays = {today - timedelta(days=6 + 7 * i): 60.0 for i in range(4)}
    rides = [PlannedRide(date(2026, 10, 8), "Messy", steps)]
    by_day = {
        d.date: d
        for d in project(
            history(today, thursdays),
            [],
            [],
            rides,
            strength_k=0.1,
            today=today,
            decay=Decay.EXPONENTIAL,
        )
    }
    thursday = by_day[date(2026, 10, 8)]
    [ride] = entries(thursday, "rides")
    assert ride["tss"] is None
    assert isinstance(ride["reason"], str) and ride["reason"]
    assert thursday.basis["cycling"] == "typical_week"
    assert thursday.cycling_tss == pytest.approx(60.0)


def test_a_readable_and_an_unreadable_ride_on_one_day_count_only_the_readable_one() -> None:
    today = date(2026, 9, 30)
    rides = [
        PlannedRide(date(2026, 10, 8), "Good", [{"minutes": 60, "pct_ftp": 100}]),
        PlannedRide(date(2026, 10, 8), "Bad", [{"minutes": "x", "pct_ftp": 100}]),
    ]
    by_day = {
        d.date: d
        for d in project(
            history(today), [], [], rides, strength_k=0.1, today=today, decay=Decay.EXPONENTIAL
        )
    }
    day = by_day[date(2026, 10, 8)]
    assert day.cycling_tss == pytest.approx(100.0) and day.basis["cycling"] == "planned"
    assert [r["tss"] is None for r in entries(day, "rides")] == [False, True]


def test_rides_outside_the_horizon_or_on_today_are_ignored() -> None:
    today = date(2026, 9, 30)
    rides = [
        PlannedRide(today, "Today", [{"minutes": 60, "pct_ftp": 100}]),
        PlannedRide(today + timedelta(days=57), "Too far", [{"minutes": 60, "pct_ftp": 100}]),
    ]
    days = project(
        history(today), [], [], rides, strength_k=0.1, today=today, decay=Decay.EXPONENTIAL
    )
    assert all(d.cycling_tss == 0 and not entries(d, "rides") for d in days)


def test_session_1_goes_on_the_weekday_it_was_done_most_often_in_the_last_4_weeks(
    make_set: MakeSet,
) -> None:
    today = date(2026, 9, 30)  # Wednesday
    sessions = [
        done(date(2026, 9, 7), 1, date(2026, 9, 7), 40.0),  # Mon
        done(date(2026, 9, 14), 1, date(2026, 9, 16), 50.0),  # Wed
        done(date(2026, 9, 21), 1, date(2026, 9, 21), 60.0),  # Mon
        done(WEEK_40, 1, date(2026, 9, 28), 70.0),  # Mon
    ]
    sets = [make_set(week_start=WEEK_40, session=1, sheet_row=1)]
    by_day = {
        d.date: d
        for d in project(
            history(today), sessions, sets, [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL
        )
    }
    monday = by_day[date(2026, 10, 5)]
    [s1] = entries(monday, "strength")
    assert s1["session"] == 1 and s1["weekday"] == "learnt" and s1["day_estimated"] is False
    # Week 41 isn't in the sheet: "recent" = the mean weekly TSS of the completed weeks before
    # this one (Sep 7, 14, 21: 40, 50, 60), with their min-max as the band.
    assert s1["method"] == "recent"
    assert monday.strength_tss == pytest.approx(50.0)
    assert (s1["tss_low"], s1["tss_high"]) == (pytest.approx(40.0), pytest.approx(60.0))
    assert monday.strength_method == "recent" and monday.ctl_band is not None


def test_without_history_sessions_spread_evenly_and_are_flagged_day_estimated(
    make_set: MakeSet,
) -> None:
    today = date(2026, 9, 30)
    week_41 = date(2026, 10, 5)
    sets = [make_set(week_start=week_41, session=n, sheet_row=n) for n in (1, 2, 3)]
    days = project(
        history(today), [], sets, [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL
    )
    by_day = {d.date: d for d in days}
    # round((n - 1) * 7 / 3) -> Mon, Wed, Sat of week 41
    for n, day in ((1, date(2026, 10, 5)), (2, date(2026, 10, 7)), (3, date(2026, 10, 10))):
        [e] = entries(by_day[day], "strength")
        assert e["session"] == n and e["weekday"] == "spread"
        assert e["day_estimated"] is True and e["moved"] is False
        # Scored from the plan (each fixture set has entered kg: score 100 x K 0.1).
        assert e["method"] == "plan" and e["tss"] == pytest.approx(10.0)


def test_passed_sessions_move_to_the_next_free_day_from_tomorrow(make_set: MakeSet) -> None:
    today = date(2026, 10, 1)  # Thursday; nothing done this week
    sets = [make_set(week_start=WEEK_40, session=n, sheet_row=n) for n in (1, 2, 3)]
    days = project(
        history(today), [], sets, [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL
    )
    by_day = {d.date: d for d in days}
    fri = entries(by_day[date(2026, 10, 2)], "strength")
    sat = entries(by_day[date(2026, 10, 3)], "strength")
    assert [(e["session"], e["moved"]) for e in fri] == [(1, True)]  # Mon passed -> Fri
    assert (2, True) in [(e["session"], e["moved"]) for e in sat]  # Wed passed, Fri taken -> Sat
    assert all(e["day_estimated"] is True for e in fri + sat)


def test_a_passed_session_with_no_day_left_is_listed_not_dropped(make_set: MakeSet) -> None:
    today = date(2026, 10, 3)  # Saturday; only Sunday is left in week 40
    sets = [make_set(week_start=WEEK_40, session=n, sheet_row=n) for n in (1, 2)]
    days = project(
        history(today), [], sets, [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL
    )
    sunday = entries(days[0], "strength")
    assert days[0].date == date(2026, 10, 4)
    assert [e["session"] for e in sunday] == [1, 2]
    assert sunday[1]["tss"] is None and sunday[1]["reason"] == "no day left this week"
