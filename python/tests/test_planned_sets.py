"""Suggested kg per planned set (domain.planned_sets, 2026-10-12)."""

from collections.abc import Callable
from datetime import date, timedelta

import pytest

from training_load.domain.exercises import Catalog, Exercise
from training_load.domain.planned_sets import (
    pct_of_e1rm,
    planned_sets,
    rolling_e1rm,
    round_to_step,
)
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import StrengthWeek, e1rm

MakeSet = Callable[..., StrengthSet]
RUN_WEEK = date(2026, 10, 12)  # a Monday
TODAY = date(2026, 10, 14)


def lift(
    id: int, name: str, parent: str | None, category: str = "main", scale: float = 1.0
) -> Exercise:
    return Exercise(id, name, (), category, parent, 1.0, None, parent is not None, scale)


CATALOG = Catalog(
    [
        lift(1, "Squat", "SQUAT"),
        lift(2, "3.0.0 Tempo squat", "SQUAT", "accessory", scale=0.8),
        lift(3, "Bænk", "BENCH"),
        lift(4, "Facepulls", None, "isolation"),
    ]
)


def week(lift: str, start: date, kg: float | None) -> StrengthWeek:
    return StrengthWeek(
        week_start=start,
        lift=lift,
        block=None,
        block_no=None,
        phase=None,
        status="lifted" if kg is not None else None,
        sets_lifted=1,
        tonnage_kg=0.0,
        e1rm_kg=kg,
        e1rm_load_kg=None,
        e1rm_reps=None,
        e1rm_rpe=None,
        e1rm_rpe_source=None,
        is_block_best=False,
    )


# The real numbers of 2026-10-12 (squat 174.13 and 174.965 in the two weeks before).
WEEKS = [
    week("SQUAT", RUN_WEEK - timedelta(weeks=2), 174.13),
    week("SQUAT", RUN_WEEK - timedelta(weeks=1), 174.965),
    week("SQUAT", RUN_WEEK, None),
    week("BENCH", RUN_WEEK - timedelta(weeks=4), 120.0),  # outside the 4-week window
]


def planned(make_set: MakeSet, **overrides: object) -> StrengthSet:
    base: dict[str, object] = {"week_start": RUN_WEEK, "session": 1, "logged_kg": None}
    return make_set(**{**base, **overrides})


def test_the_users_example_squat_3_at_rpe_6_suggests_142_5(make_set: MakeSet) -> None:
    s = planned(make_set, type="SQUAT", name="Squat", reps=3.0, prescribed="RPE 6")
    [p] = planned_sets([s], CATALOG, WEEKS, today=TODAY)
    assert (p.e1rm_lift, p.e1rm_kg, p.rpe, p.basis) == ("SQUAT", 174.965, 6.0, "rpe_e1rm")
    assert p.pct == pytest.approx(1 / 1.2331)
    assert p.suggested_kg == 142.5  # 174.965 x 0.811 = 141.9 -> 142.5


def test_a_suggestion_is_the_exact_inverse_of_the_e1rm_formula() -> None:
    for reps, rpe in [(1, 10), (3, 6), (5, 7.5), (8, 5.5)]:
        assert e1rm(100 * pct_of_e1rm(reps, rpe), reps, rpe) == pytest.approx(100)


@pytest.mark.parametrize(
    ("kg", "expected"), [(141.25, 142.5), (141.24, 140.0), (142.5, 142.5), (1.2, 0.0)]
)
def test_rounding_is_to_the_nearest_2_5_halves_up(kg: float, expected: float) -> None:
    assert round_to_step(kg) == expected


def test_the_rolling_e1rm_is_the_best_week_of_the_last_four() -> None:
    assert rolling_e1rm(WEEKS, "SQUAT", RUN_WEEK) == 174.965
    assert rolling_e1rm(WEEKS, "BENCH", RUN_WEEK) is None  # 4 weeks back is outside
    assert rolling_e1rm(WEEKS, "BENCH", RUN_WEEK - timedelta(weeks=1)) == 120.0
    assert rolling_e1rm(WEEKS, "DEADLIFT", RUN_WEEK) is None


def test_a_variant_uses_its_parent_lift_and_a_range_its_middle(make_set: MakeSet) -> None:
    s = planned(make_set, type="SQUAT", name="3.0.0 tempo squat ", reps=3.0, prescribed="RPE 5 - 7")
    [p] = planned_sets([s], CATALOG, WEEKS, today=TODAY)
    assert (p.exercise_id, p.e1rm_lift, p.rpe) == (2, "SQUAT", 6.0)
    # The tempo variant's suggestion_scale (0.8): 174.965 x 0.811 x 0.8 = 113.5 -> 112.5
    assert p.suggested_kg == round_to_step(174.965 * pct_of_e1rm(3, 6) * 0.8) == 112.5


@pytest.mark.parametrize(
    ("name", "prescribed", "basis"),
    [
        ("Squat", "-12.5%", "not_rpe"),  # a back-off row: not RPE-based
        ("Squat", None, "not_rpe"),
        ("Squat", "RPE 7,8", "not_rpe"),  # unreadable RPE is never used
        ("Facepulls", "RPE 8 - 9", "no_lift"),  # an accessory without a parent lift
        ("Nordic curl", "RPE 8", "no_lift"),  # not in the catalogue
        ("Bænk", "RPE 7", "no_e1rm"),  # no bench e1RM in the window
    ],
)
def test_no_suggestion_is_null_with_its_reason(
    make_set: MakeSet, name: str, prescribed: str | None, basis: str
) -> None:
    s = planned(make_set, type="SQUAT", name=name, reps=5.0, prescribed=prescribed)
    [p] = planned_sets([s], CATALOG, WEEKS, today=TODAY)
    assert (p.suggested_kg, p.basis) == (None, basis)
    assert p.e1rm_kg is None


def test_only_this_week_and_later_get_rows(make_set: MakeSet) -> None:
    sets = [
        planned(make_set, name="Squat", type="SQUAT", prescribed="RPE 6", week_start=start)
        for start in (RUN_WEEK - timedelta(weeks=1), RUN_WEEK, RUN_WEEK + timedelta(weeks=1))
    ]
    got = [p.week_start for p in planned_sets(sets, CATALOG, WEEKS, today=TODAY)]
    assert got == [RUN_WEEK, RUN_WEEK + timedelta(weeks=1)]
