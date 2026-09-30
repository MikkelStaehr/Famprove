"""domain.sessions: the n-th strength activity of an ISO week is session n (acceptance tests)."""

from collections.abc import Callable
from datetime import date, datetime

import pytest

from conftest import BLOK_11_SECTIONS, SYNTHETIC_BODYWEIGHT, SYNTHETIC_SHEET_ID, build_workbook
from training_load.cli.collect_strength import section_key, to_domain
from training_load.domain.sessions import (
    StrengthActivity,
    StrengthSession,
    daily_strength_tss,
    match_sessions,
)
from training_load.domain.strength import StrengthSet, number_sessions
from training_load.sources.strength_sheet import parse_all

MakeSet = Callable[..., StrengthSet]
K = 0.10
BLOK_12 = "Program - blok 12"
WEEK_40 = date(2026, 9, 28)
WEEK_40_DAYS = ("2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01")


def lift(activity_id: str, start: str, moving_time_s: int = 4368) -> StrengthActivity:
    return StrengthActivity(
        id=activity_id,
        start_date_local=datetime.fromisoformat(start),
        type="WeightTraining",
        name="Styrke",
        moving_time_s=moving_time_s,
        elapsed_time_s=None,
        training_load=22,
        device_name="fenix 6",
    )


@pytest.fixture
def week_40(make_set: MakeSet) -> list[StrengthSet]:
    """Blok 12 week 1: sessions 1-3. Session 3 has kg pre-filled by a sheet formula."""
    common = {"block": BLOK_12, "week": 1, "week_start": WEEK_40}
    return [
        make_set(**common, session=1, sheet_row=10, score=400.0),
        make_set(**common, session=1, sheet_row=11, score=100.0),
        make_set(**common, session=2, sheet_row=20, score=300.0, logged_kg=0.0),
        make_set(**common, session=3, sheet_row=30, score=250.0, logged_kg=125.0),
    ]


def test_week_40_example(week_40: list[StrengthSet]) -> None:
    """Tue 29 Sept = session 1 (Styrke 1:12:48); Mon 28 rest; Wed 30 no strength yet."""
    sessions = match_sessions(week_40, [lift("i1", "2026-09-29T10:35:00")], K)

    assert [(s.session, s.date) for s in sessions] == [
        (1, date(2026, 9, 29)),
        (2, None),
        (3, None),
    ]
    first = sessions[0]
    assert (first.activity_name, first.moving_time_s, first.block) == ("Styrke", 4368, BLOK_12)
    assert first.tss == pytest.approx(500.0 * K)
    daily = daily_strength_tss(sessions)
    assert daily == pytest.approx({date(2026, 9, 29): 500.0 * K})
    assert date(2026, 9, 28) not in daily and date(2026, 9, 30) not in daily
    # Today on Wed 30: next session = activities this week + 1 = 2, and it has no date.
    done = sum(1 for s in sessions if s.week_start == WEEK_40 and s.activity_id)
    assert done + 1 == 2 and sessions[1].date is None


def test_prefilled_kg_adds_nothing_until_an_activity_matches(week_40: list[StrengthSet]) -> None:
    one = match_sessions(week_40, [lift("i1", "2026-09-29T10:35:00")], K)
    assert one[2].tss == 0.0  # session 3 has kg (formula) but no activity yet
    three = match_sessions(
        week_40,
        [
            lift("i1", "2026-09-29T10:35:00"),
            lift("i2", "2026-09-30T18:00:00"),
            lift("i3", "2026-10-02T18:00:00"),
        ],
        K,
    )
    assert [s.date for s in three] == [date(2026, 9, 29), date(2026, 9, 30), date(2026, 10, 2)]
    assert three[2].tss == pytest.approx(250.0 * K)


def test_activities_without_a_planned_session_are_extras_with_zero_tss(
    week_40: list[StrengthSet],
) -> None:
    # Week 39 has no program; week 40 gets a 4th activity beyond its 3 sessions.
    lifts = [
        lift("a", "2026-09-22T19:22:00"),
        lift("b", "2026-09-25T19:58:00"),
        *(lift(f"w{n}", f"{day}T18:00:00") for n, day in enumerate(WEEK_40_DAYS)),
    ]
    sessions = match_sessions(week_40, lifts, K)
    extras = [s for s in sessions if s.block is None]
    assert [(s.week_start, s.session, s.date, s.tss) for s in extras] == [
        (date(2026, 9, 21), 1, date(2026, 9, 22), 0.0),
        (date(2026, 9, 21), 2, date(2026, 9, 25), 0.0),
        (WEEK_40, 4, date(2026, 10, 1), 0.0),
    ]


def test_two_activities_on_one_day_are_consecutive_sessions_summed(
    week_40: list[StrengthSet],
) -> None:
    lifts = [lift("late", "2026-09-29T18:00:00"), lift("early", "2026-09-29T07:00:00")]
    sessions = match_sessions(week_40, lifts, K)
    assert [(s.session, s.activity_id) for s in sessions[:2]] == [(1, "early"), (2, "late")]
    assert daily_strength_tss(sessions) == pytest.approx({date(2026, 9, 29): 800.0 * K})


def test_a_deleted_activity_renumbers_the_week(week_40: list[StrengthSet]) -> None:
    both = [lift("i1", "2026-09-29T10:35:00"), lift("i2", "2026-09-30T18:00:00")]
    before = match_sessions(week_40, both, K)
    after = match_sessions(week_40, both[1:], K)
    assert [s.activity_id for s in before] == ["i1", "i2", None]
    assert [s.activity_id for s in after] == ["i2", None, None]
    assert daily_strength_tss(after) == pytest.approx({date(2026, 9, 30): 500.0 * K})


def test_matching_is_deterministic(week_40: list[StrengthSet]) -> None:
    lifts = [lift("i1", "2026-09-29T10:35:00"), lift("i2", "2026-09-30T18:00:00")]
    assert match_sessions(week_40, lifts, K) == match_sessions(week_40, lifts[::-1], K)


def test_two_sheet_weeks_claiming_one_slot_fail(make_set: MakeSet) -> None:
    clash = [
        make_set(block=BLOK_12, week=1, week_start=WEEK_40, session=1),
        make_set(block="Program - blok 13", week=1, week_start=WEEK_40, session=1),
    ]
    with pytest.raises(ValueError, match="prescribed twice"):
        match_sessions(clash, [], K)


def test_undone_session_row(week_40: list[StrengthSet]) -> None:
    [*_, third] = match_sessions(week_40, [], K)
    assert third == StrengthSession(
        week_start=WEEK_40,
        session=3,
        sheet_id=SYNTHETIC_SHEET_ID,
        block=BLOK_12,
        week=1,
        activity_id=None,
        date=None,
        activity_name=None,
        moving_time_s=None,
        tss=0.0,
    )


def _workbook_sets(workbook: bytes) -> list[StrengthSet]:
    parsed = parse_all(workbook, SYNTHETIC_BODYWEIGHT)
    slots = number_sessions((section_key(p), p["date"]) for p in parsed)
    return [to_domain(p, SYNTHETIC_SHEET_ID, slots[section_key(p)]) for p in parsed]


def test_changing_a_date_row_changes_no_output() -> None:
    # Move the second day section from Thursday to Saturday and the first to Tuesday.
    (dates_1, rows_1), (dates_2, rows_2) = BLOK_11_SECTIONS
    moved = [
        ([replace_day(d, 1) for d in dates_1], rows_1),
        ([replace_day(d, 2) for d in dates_2], rows_2),
    ]
    assert _workbook_sets(build_workbook(moved)) == _workbook_sets(build_workbook())


def replace_day(day: date, days: int) -> date:
    return day.replace(day=day.day + days)
