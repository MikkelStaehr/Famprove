"""range-order (user, 2026-10-20): the sheet may write an interval reversed ("RPE 7 - 5",
"10 - 6"); it is shown as written, and every calculation on it (a midpoint, a range's top) uses
the numbers, never their order."""

from collections.abc import Callable
from dataclasses import replace
from datetime import date, timedelta

import pytest

from training_load.domain.exercises import Catalog, Exercise
from training_load.domain.last_week import reps_key, same_prescribed_reps
from training_load.domain.planned_load import prescribed_rpe
from training_load.domain.planned_sets import PlannedSet, planned_sets
from training_load.domain.set_feedback import range_top
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import KgStatus, SetKey, e1rm_point, set_key
from training_load.domain.today_kg import TodayKg, ref, today_kgs

MakeSet = Callable[..., StrengthSet]
RUN_WEEK = date(2026, 10, 12)  # a Monday
LAST_WEEK = RUN_WEEK - timedelta(weeks=1)
CATALOG = Catalog([Exercise(1, "Squat", (), "main", "SQUAT", 1.0, None, True, 1.0)])


@pytest.mark.parametrize(
    ("usual", "reversed_"),
    [("RPE 5 - 7", "RPE 7 - 5"), ("RPE 5-7", "RPE 7-5"), ("RPE 6 - 7,5", "RPE 7,5 - 6")],
)
def test_the_prescribed_rpe_is_the_same_midpoint_either_way(usual: str, reversed_: str) -> None:
    assert prescribed_rpe(reversed_) == prescribed_rpe(usual)
    assert prescribed_rpe("RPE 7 - 5") == 6.0
    assert prescribed_rpe("RPE 7,5 - 6") == 6.75


def test_a_range_top_is_its_highest_number() -> None:
    assert range_top("10 - 6") == 10
    assert range_top("10 - 6") == range_top("6 - 10")
    assert range_top("12,5 - 10") == 12.5


def test_the_e1rm_rule_reads_a_reversed_rpe_range_alike(make_set: MakeSet) -> None:
    s = make_set(type="SQUAT", name="Squat", reps=3.0, logged_kg=140.0, prescribed="RPE 7 - 8")
    flipped = replace(s, prescribed="RPE 8 - 7")
    assert e1rm_point(flipped, "lifted") == e1rm_point(s, "lifted")
    assert e1rm_point(s, "lifted") is not None


def _today(sibling: str) -> TodayKg:
    """Row 77 has no kg; it is derived from row 78 (the highest-RPE sibling, 145 kg)."""
    sets = [
        StrengthSet(
            sheet_id="s", block="Program - blok 12", sheet_row=row, week=3, set_no=1,
            week_start=RUN_WEEK, session=2, type="DEADLIFT", name="Dødløft", reps=3, logged_kg=kg,
            kg=kg or 0.0, bodyweight=False, rpe=None, score=0.0, prescribed=prescribed,
        )
        for row, prescribed, kg in ((77, "RPE 6", None), (78, sibling, 145.0))
    ]  # fmt: skip
    got = today_kgs(sets, {ref(s): None for s in sets}, run_week=RUN_WEEK, statuses={})
    return got[ref(sets[0])]


def test_today_kg_derives_alike_from_a_reversed_rpe_range() -> None:
    assert _today("RPE 8 - 6") == _today("RPE 6 - 8")
    assert _today("RPE 6 - 8").basis == "derived"


def _plan(make_set: MakeSet, reps_text: str, rpe: str, last_rpe: str) -> list[PlannedSet]:
    statuses: dict[SetKey, KgStatus] = {}
    sets: list[StrengthSet] = []
    for week, kg, prescribed in ((9, 100.0, last_rpe), (10, None, rpe)):
        # reps 8 is the parser's mid of either order; the e1RM comes from row 1's 3 @ RPE 7 - 8
        week_start = LAST_WEEK if week == 9 else RUN_WEEK
        same = {"type": "SQUAT", "name": "Squat", "week_start": week_start, "week": week}
        main = make_set(**same, sheet_row=1, reps=3.0, logged_kg=kg and 145.0, prescribed=last_rpe)
        back = make_set(
            **same, sheet_row=2, reps=8.0, reps_text=reps_text, logged_kg=kg, prescribed=prescribed
        )
        for s in (main, back):
            sets.append(s)
            statuses[set_key(s)] = "lifted" if week_start < RUN_WEEK else "planned"
    return planned_sets(sets, CATALOG, statuses, today=RUN_WEEK + timedelta(days=1))


def test_planned_sets_give_the_same_numbers_for_a_reversed_range(make_set: MakeSet) -> None:
    usual = _plan(make_set, "6 - 10", "RPE 5 - 7", "RPE 7 - 8")
    flipped = _plan(make_set, "10 - 6", "RPE 7 - 5", "RPE 8 - 7")
    assert flipped == usual
    back = [p for p in usual if p.sheet_row == 2]
    assert [(p.rpe, p.reps) for p in back] == [(6.0, 8.0)]
    assert back[0].suggested_kg is not None


def test_last_weeks_anchor_matches_a_range_written_in_either_order(make_set: MakeSet) -> None:
    """range-order (user, 2026-10-17): "6 - 10" last week and "10 - 6" this week are the same
    prescribed reps, so the weekly cap's anchor still applies."""
    assert reps_key("10 - 6") == reps_key("6 - 10") == reps_key("6-10") == (6.0, 10.0)
    assert reps_key("3") == "3" and reps_key(" 5 ") == "5"
    last = make_set(reps_text="6 - 10")
    now = make_set(reps_text="10 - 6")
    assert same_prescribed_reps(last, now)
    assert not same_prescribed_reps(make_set(reps_text="6 - 10"), make_set(reps_text="8 - 12"))
