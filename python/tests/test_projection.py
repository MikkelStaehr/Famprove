"""domain.projection: the prognose half of /load (tech-lead acceptance criteria 1-4)."""

import math
from collections.abc import Callable
from datetime import date, timedelta

import pytest

from training_load.domain.daily import DailyLoad, build_daily_load
from training_load.domain.load import Decay
from training_load.domain.plan import parse_steps
from training_load.domain.projection import (
    HORIZON_DAYS,
    PlannedRide,
    ProjectedDay,
    learnt_weekdays,
    project,
    ride_tss,
    spread_weekday,
)
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet

MakeSet = Callable[..., StrengthSet]
TODAY = date(2026, 9, 30)  # a Wednesday, ISO week 40
WEEK_40 = date(2026, 9, 28)


def history(
    cycling: dict[date, float] | None = None, strength: dict[date, float] | None = None
) -> list[DailyLoad]:
    return build_daily_load(
        cycling or {}, strength or {}, start=date(2026, 1, 1), end=TODAY, decay=Decay.EXPONENTIAL
    )


def entries(day: ProjectedDay, key: str) -> list[dict[str, object]]:
    """The basis list under ``key`` (rides or strength), narrowed for the assertions."""
    value = day.basis[key]
    assert isinstance(value, list)
    return [e for e in value if isinstance(e, dict)]


def done(week_start: date, n: int, day: date, tss: float = 50.0) -> StrengthSession:
    return StrengthSession(
        week_start, n, "s", "Program - blok 12", 1, f"i{day}{n}", day, "Styrke", 3600, tss
    )


def planned(week_start: date, n: int) -> StrengthSession:
    return StrengthSession(week_start, n, "s", "Program - blok 12", 1, None, None, None, None, 0.0)


def test_ride_tss_is_np_style() -> None:
    assert ride_tss(parse_steps([{"minutes": 60, "pct_ftp": 100}])) == pytest.approx(100)
    example = parse_steps(
        [
            {"minutes": 20, "pct_ftp": 55},
            {"repeat": 4, "steps": [{"minutes": 8, "pct_ftp": 95}, {"minutes": 4, "pct_ftp": 55}]},
        ]
    )
    assert round(ride_tss(example)) == 74


def test_no_load_is_pure_decay_seeded_from_today() -> None:
    days = history({date(2026, 6, 1): 400.0})  # load long before the typical-week window
    [*_, last] = project(days, [], [], [], today=TODAY, decay=Decay.EXPONENTIAL)
    seed = days[-1]
    assert last.date == TODAY + timedelta(days=HORIZON_DAYS)
    assert last.ctl == pytest.approx(seed.ctl * math.exp(-HORIZON_DAYS / 42), abs=1e-9)
    assert last.atl == pytest.approx(seed.atl * math.exp(-HORIZON_DAYS / 7), abs=1e-9)


def test_typical_week_and_a_planned_ride_that_replaces_it() -> None:
    thursdays = {TODAY - timedelta(days=6 + 7 * i): 60.0 for i in range(4)}  # 24/9, 17/9, ...
    rides = [
        PlannedRide(date(2026, 10, 8), "Zwift", [{"minutes": 60, "pct_ftp": 100}]),
        PlannedRide(date(2026, 10, 15), "Broken", [{"minutes": "x"}]),
    ]
    days = project(history(thursdays), [], [], rides, today=TODAY, decay=Decay.EXPONENTIAL)
    by_day = {d.date: d for d in days}
    assert by_day[date(2026, 10, 1)].cycling_tss == pytest.approx(60.0)  # a typical Thursday
    assert by_day[date(2026, 10, 1)].basis["cycling"] == "typical_week"
    assert by_day[date(2026, 10, 8)].cycling_tss == pytest.approx(100.0)  # the planned ride
    assert by_day[date(2026, 10, 8)].basis["cycling"] == "planned"
    broken = by_day[date(2026, 10, 15)]
    [ride] = entries(broken, "rides")
    assert ride["tss"] is None and "reason" in ride
    assert broken.cycling_tss == pytest.approx(60.0)  # never a silent 0: the typical day stands


def test_learnt_weekday_is_the_most_common_one_and_spread_is_the_fallback() -> None:
    sessions = [
        done(date(2026, 9, 7), 1, date(2026, 9, 7)),  # Monday
        done(date(2026, 9, 14), 1, date(2026, 9, 15)),  # Tuesday
        done(date(2026, 9, 21), 1, date(2026, 9, 21)),  # Monday
    ]
    assert learnt_weekdays(sessions, TODAY) == {1: 0}
    assert [spread_weekday(n, 3) for n in (1, 2, 3)] == [0, 2, 5]
    assert [spread_weekday(n, 2) for n in (1, 2)] == [0, 4]


def test_strength_sessions_are_placed_estimated_and_continue_the_pattern(make_set: MakeSet) -> None:
    # Week 40 plans 3 sessions; session 1 was done Tue 29/9 (it's learnt as Tuesday).
    sets = [make_set(week_start=WEEK_40, session=n, sheet_row=n) for n in (1, 2, 3)]
    sessions = [
        done(WEEK_40, 1, date(2026, 9, 29), tss=150.0),
        planned(WEEK_40, 2),
        planned(WEEK_40, 3),
    ]
    days = project(history(), sessions, sets, [], today=TODAY, decay=Decay.EXPONENTIAL)
    by_day = {d.date: d for d in days}
    # Session 2 has no history: spread over 3 -> Wednesday (today) has passed -> moves to Thu.
    thu = entries(by_day[date(2026, 10, 1)], "strength")
    assert [(e["session"], e["day_estimated"], e["moved"]) for e in thu] == [(2, True, True)]
    assert thu[0]["tss"] is None and "reason" in thu[0]
    # Next week repeats the 3 sessions; session 1 lands on its learnt Tuesday with its mean TSS.
    tue = by_day[date(2026, 10, 6)]
    assert tue.strength_tss == pytest.approx(150.0)
    assert entries(tue, "strength")[0]["day_estimated"] is False
    assert sum(1 for d in days if entries(d, "strength")) >= 3 * 7  # 8 weeks of sessions


def test_projection_starts_from_today_only() -> None:
    with pytest.raises(ValueError, match="today"):
        project(history(), [], [], [], today=TODAY + timedelta(days=1))


def test_every_strength_entry_has_the_same_keys_even_on_a_sunday(make_set: MakeSet) -> None:
    """The web parser needs day_estimated on every entry; on a Sunday nothing fits this week."""
    sunday = date(2026, 10, 4)
    sets = [make_set(week_start=WEEK_40, session=n, sheet_row=n) for n in (1, 2, 3)]
    sessions = [done(WEEK_40, 1, date(2026, 9, 29)), planned(WEEK_40, 2), planned(WEEK_40, 3)]
    days = build_daily_load({}, {}, start=date(2026, 1, 1), end=sunday, decay=Decay.EXPONENTIAL)
    projected = project(days, sessions, sets, [], today=sunday, decay=Decay.EXPONENTIAL)
    all_entries = [e for d in projected for e in entries(d, "strength")]
    keys = {"session", "tss", "weekday", "moved", "day_estimated", "planned_in_sheet"}
    assert all(keys <= e.keys() for e in all_entries)
    no_day = [e for e in all_entries if e.get("reason") == "no day left this week"]
    assert [e["session"] for e in no_day] == [2, 3]
    assert all(e["day_estimated"] is True for e in no_day)
