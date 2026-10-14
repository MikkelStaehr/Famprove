"""Suggested kg per planned set (domain.planned_sets, 2026-10-12; e1RM rule and weekly cap
2026-10-13)."""

from collections.abc import Callable
from datetime import date, timedelta

import pytest

from training_load.domain.exercises import Catalog, Exercise, ExerciseVariant
from training_load.domain.planned_sets import (
    PlannedSet,
    cap_kg,
    pct_of_e1rm,
    planned_sets,
    rolling_e1rm,
    round_to_step,
    weekly_cap,
)
from training_load.domain.set_feedback import Progression, VariantKey
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import KgStatus, SetKey, e1rm, e1rm_point, set_key

MakeSet = Callable[..., StrengthSet]
RUN_WEEK = date(2026, 10, 12)  # a Monday
LAST_WEEK = RUN_WEEK - timedelta(weeks=1)
TODAY = date(2026, 10, 13)


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


class Sheet:
    """Sets with distinct keys; every set before RUN_WEEK is lifted unless said otherwise."""

    def __init__(self, make_set: MakeSet) -> None:
        self.make_set = make_set
        self.sets: list[StrengthSet] = []
        self.statuses: dict[SetKey, KgStatus] = {}

    def add(self, status: KgStatus | None = None, /, **fields: object) -> StrengthSet:
        base: dict[str, object] = {
            "week_start": RUN_WEEK,
            "session": 1,
            "sheet_row": 100 + len(self.sets),
            "logged_kg": None,
            "type": "SQUAT",
            "name": "Squat",
        }
        merged = {**base, **fields}
        start = merged["week_start"]
        assert isinstance(start, date)
        merged["week"] = 10 + (start - RUN_WEEK).days // 7  # the block week: one per ISO week
        s = self.make_set(**merged)
        self.sets.append(s)
        self.statuses[set_key(s)] = status or ("lifted" if s.week_start < RUN_WEEK else "planned")
        return s

    def plan(self) -> list[PlannedSet]:
        planned = [s for s in self.sets if s.week_start >= RUN_WEEK]
        return [
            p
            for p in planned_sets(self.sets, CATALOG, self.statuses, today=TODAY)
            if (p.sheet_row, p.week_start) in {(s.sheet_row, s.week_start) for s in planned}
        ]


@pytest.fixture
def sheet(make_set: MakeSet) -> Sheet:
    return Sheet(make_set)


def test_only_low_rep_sets_at_rpe_7_or_more_count(sheet: Sheet) -> None:
    top = sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=145.0)
    assert e1rm_point(top, "lifted") is not None

    def past(**fields: object) -> StrengthSet:
        return sheet.add(week_start=LAST_WEEK, **fields)

    excluded = [
        past(reps=8.0, prescribed="RPE 5 - 7", logged_kg=125.0),  # 8 reps
        past(reps=6.0, prescribed="RPE 8", logged_kg=130.0),  # 6 reps
        past(reps=3.0, prescribed="RPE 6.5", logged_kg=150.0),  # RPE < 7
        past(reps=5.0, prescribed="-10%", logged_kg=130.0),  # % row
        past(reps=3.0, prescribed="RPE 8", name="3.0.0 Tempo squat",
                  logged_kg=150.0),  # a variant
        past(reps=3.0, prescribed="RPE 8", logged_kg=None),  # no kg
    ]  # fmt: skip
    assert not any(e1rm_point(s, "lifted") for s in excluded)
    assert e1rm_point(top, "planned") is None  # the plan never counts
    value = rolling_e1rm(sheet.sets, sheet.statuses, "SQUAT", RUN_WEEK)
    assert value == pytest.approx(e1rm(145.0, 3, 7))


def test_a_logged_rpe_sets_the_value_and_old_weeks_drop_out(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=140.0, logged_rpe=8.0)
    sheet.add(week_start=RUN_WEEK - timedelta(weeks=4), reps=1.0, prescribed="RPE 9",
              logged_kg=170.0)  # fmt: skip
    assert rolling_e1rm(sheet.sets, sheet.statuses, "SQUAT", RUN_WEEK) == pytest.approx(
        e1rm(140.0, 3, 8)
    )
    assert rolling_e1rm(sheet.sets, sheet.statuses, "BENCH", RUN_WEEK) is None


def test_the_users_bench_of_2026_10_13(sheet: Sheet) -> None:
    """Last week: 82.5 x 3 @ 6, 85 x 3 @ 7, 78.5 x 8 @ 5-7 (the back-off that put e1RM at 110)."""
    for row, reps, rx, kg in [(28, 3.0, "RPE 6", 82.5), (29, 3.0, "RPE 7", 85.0),
                              (30, 8.0, "RPE 5 - 7", 78.5)]:  # fmt: skip
        sheet.add(
            week_start=LAST_WEEK,
            sheet_row=row,
            reps=reps,
            prescribed=rx,
            logged_kg=kg,
            type="BENCH",
            name="Bænk",
        )
        sheet.add(sheet_row=row, reps=reps, prescribed=rx, type="BENCH", name="Bænk")
    by_row = {p.sheet_row: p for p in sheet.plan()}
    assert by_row[28].e1rm_kg == pytest.approx(e1rm(85.0, 3, 7))  # 101.98, from the RPE 7 set
    assert (by_row[28].suggested_kg, by_row[28].uncapped_kg) == (82.5, None)  # was 90
    assert (by_row[29].suggested_kg, by_row[29].uncapped_kg) == (85.0, None)  # was 92.5
    # 8 @ 6: 101.98 x 0.7145 = 72.9 -> 72.5; the cap only limits a rise
    assert (by_row[30].suggested_kg, by_row[30].uncapped_kg) == (72.5, None)


def test_squat_without_a_qualifying_set_has_no_suggestion(sheet: Sheet) -> None:
    """2026-10-13: every squat top set of the block so far was RPE 5-6.5."""
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 6.5", logged_kg=142.5)
    s = sheet.add(reps=3.0, prescribed="RPE 7")
    [p] = [p for p in sheet.plan() if p.sheet_row == s.sheet_row]
    assert (p.suggested_kg, p.basis, p.e1rm_kg) == (None, "no_e1rm", None)


@pytest.mark.parametrize(
    ("suggested", "last", "up", "expected"),
    [
        (90.0, 82.5, 2.5, (85.0, 90.0)),  # upper body: up at most 2.5
        (85.0, 82.5, 2.5, (85.0, None)),  # exactly +2.5: not capped
        (150.0, 140.0, 5.0, (145.0, 150.0)),  # lower body: up at most 5
        (70.0, 80.0, 2.5, (70.0, None)),  # a fall is never capped
        (85.0, 78.5, 2.5, (80.0, 85.0)),  # 78.5 + 2.5 = 81, rounded down to 80
        (80.0, None, 2.5, (80.0, None)),  # nothing logged last week: no cap
    ],
)
def test_the_weekly_cap(
    suggested: float, last: float | None, up: float, expected: tuple[float, float | None]
) -> None:
    assert weekly_cap(suggested, last, up) == expected


@pytest.mark.parametrize(
    ("sheet_type", "up"),
    [("BENCH", 2.5), ("SQUAT", 5.0), ("DEADLIFT", 5.0), ("QUADS/ADDUCTORS/GLUTES", 5.0),
     ("HAMSTRINGS", 5.0), ("CHEST/SHOULDERS", 2.5), ("LATS/MIDDLE BACK", 2.5)],
)  # fmt: skip
def test_upper_body_rises_2_5_and_lower_body_5_a_week(sheet_type: str, up: float) -> None:
    assert cap_kg(sheet_type) == up


def test_the_cap_follows_the_row_whatever_the_rpe(sheet: Sheet) -> None:
    """The programme's RPE +0.5 a week must not bypass the cap (user, 2026-10-13)."""
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=150.0)  # e1RM 180
    sheet.add(week_start=LAST_WEEK, sheet_row=40, reps=3.0, prescribed="RPE 6", logged_kg=120.0)
    sheet.add(week_start=LAST_WEEK, sheet_row=41, reps=8.0, prescribed="RPE 6", logged_kg=110.0)
    sheet.add(week_start=LAST_WEEK, sheet_row=42, reps=3.0, prescribed="RPE 6", logged_kg=120.0,
              name="3.0.0 Tempo squat")  # fmt: skip
    progressed = sheet.add(sheet_row=40, reps=3.0, prescribed="RPE 6.5")
    fewer_reps = sheet.add(sheet_row=41, reps=3.0, prescribed="RPE 6")
    other_exercise = sheet.add(sheet_row=42, reps=3.0, prescribed="RPE 6")
    by_row = {p.sheet_row: p for p in sheet.plan()}
    # 3 @ 6.5 from e1RM 180: 148 -> 147.5, capped at 120 + 5 (squat is lower body)
    assert (by_row[40].suggested_kg, by_row[40].uncapped_kg) == (125.0, 147.5)
    assert by_row[fewer_reps.sheet_row].uncapped_kg is None  # 8 reps last week, 3 now
    assert by_row[other_exercise.sheet_row].uncapped_kg is None  # tempo last week, squat now
    assert progressed.sheet_row == 40


def test_a_suggestion_is_the_exact_inverse_of_the_e1rm_formula() -> None:
    for reps, rpe in [(1, 10), (3, 6), (5, 7.5), (8, 5.5)]:
        assert e1rm(100 * pct_of_e1rm(reps, rpe), reps, rpe) == pytest.approx(100)


@pytest.mark.parametrize(
    ("kg", "expected"), [(141.25, 142.5), (141.24, 140.0), (142.5, 142.5), (1.2, 0.0)]
)
def test_rounding_is_to_the_nearest_2_5_halves_up(kg: float, expected: float) -> None:
    assert round_to_step(kg) == expected


def test_a_variant_uses_its_parent_lift_and_a_range_its_middle(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=145.0)
    s = sheet.add(name="3.0.0 tempo squat ", reps=3.0, prescribed="RPE 5 - 7")
    [p] = [p for p in sheet.plan() if p.sheet_row == s.sheet_row]
    assert (p.exercise_id, p.e1rm_lift, p.rpe) == (2, "SQUAT", 6.0)
    # The tempo variant's suggestion_scale (0.8)
    assert p.suggested_kg == round_to_step(e1rm(145.0, 3, 7) * pct_of_e1rm(3, 6) * 0.8)


@pytest.mark.parametrize(
    ("name", "prescribed", "basis"),
    [
        ("Squat", "-12.5%", "not_rpe"),  # a back-off row: not RPE-based
        ("Squat", None, "not_rpe"),
        ("Squat", "RPE 7,8", "not_rpe"),  # unreadable RPE is never used
        ("Facepulls", "RPE 8 - 9", "no_lift"),  # an accessory without a parent lift
        ("Nordic curl", "RPE 8", "no_lift"),  # not in the catalogue
        ("Bænk", "RPE 7", "no_e1rm"),  # no qualifying bench set in the window
    ],
)
def test_no_suggestion_is_null_with_its_reason(
    sheet: Sheet, name: str, prescribed: str | None, basis: str
) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=145.0)
    s = sheet.add(name=name, reps=5.0, prescribed=prescribed)
    [p] = [p for p in sheet.plan() if p.sheet_row == s.sheet_row]
    assert (p.suggested_kg, p.basis, p.e1rm_kg, p.uncapped_kg) == (None, basis, None, None)


def test_only_this_week_and_later_get_rows(sheet: Sheet) -> None:
    for start in (LAST_WEEK, RUN_WEEK, RUN_WEEK + timedelta(weeks=1)):
        sheet.add(week_start=start, sheet_row=50, prescribed="RPE 7", reps=3.0)
    got = [
        p.week_start
        for p in planned_sets(sheet.sets, CATALOG, sheet.statuses, today=TODAY)
        if p.sheet_row == 50
    ]
    assert got == [RUN_WEEK, RUN_WEEK + timedelta(weeks=1)]


def test_no_cap_in_week_1_of_a_new_block_or_after_a_missed_session(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=150.0)  # e1RM 180
    # The same row number last week, but in the previous block: not the same prescription.
    sheet.add(week_start=LAST_WEEK, block="Program - blok 10", sheet_row=60, reps=3.0,
              prescribed="RPE 6", logged_kg=120.0)  # fmt: skip
    new_block = sheet.add(sheet_row=60, reps=3.0, prescribed="RPE 6")
    # Last week's session was missed: its pre-filled kg is the plan, not an anchor.
    sheet.add("planned", week_start=LAST_WEEK, sheet_row=61, reps=3.0, prescribed="RPE 6",
              logged_kg=120.0)  # fmt: skip
    missed = sheet.add(sheet_row=61, reps=3.0, prescribed="RPE 6")
    by_row = {p.sheet_row: p for p in sheet.plan()}
    for s in (new_block, missed):
        assert (by_row[s.sheet_row].suggested_kg, by_row[s.sheet_row].uncapped_kg) == (145.0, None)


def test_an_implausible_e1rm_is_left_out(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=900.0)  # a typo
    assert rolling_e1rm(sheet.sets, sheet.statuses, "SQUAT", RUN_WEEK) is None


def test_a_step_up_adds_the_region_step_inside_the_cap(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=145.0, type="BENCH",
              name="Bænk")  # e1RM 174  # fmt: skip
    sheet.add(week_start=LAST_WEEK, sheet_row=40, reps=3.0, prescribed="RPE 6", logged_kg=140.0,
              type="BENCH", name="Bænk")  # fmt: skip
    s = sheet.add(sheet_row=40, reps=3.0, prescribed="RPE 6", type="BENCH", name="Bænk")
    rules: dict[VariantKey, Progression] = {
        (3, None): Progression("step", "de sidste to var lettere")
    }
    [p] = [
        p
        for p in planned_sets(sheet.sets, CATALOG, sheet.statuses, today=TODAY, progressions=rules)
        if p.sheet_row == s.sheet_row
    ]
    # e1RM 174 x 0.811 = 141 -> 140, + 2.5 (upper body) = 142.5, inside the cap (140 + 2.5)
    assert (p.suggested_kg, p.adjustment_kg, p.adjustment_reason) == (
        142.5,
        2.5,
        "de sidste to var lettere",
    )
    assert (p.rpe_kg, p.uncapped_kg) == (140.0, None)


def test_hold_keeps_last_weeks_kg_and_an_accessory_progresses_from_it(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=150.0)  # squat e1RM 180
    sheet.add(week_start=LAST_WEEK, sheet_row=40, reps=3.0, prescribed="RPE 6", logged_kg=140.0)
    held = sheet.add(sheet_row=40, reps=3.0, prescribed="RPE 6")
    sheet.add(week_start=LAST_WEEK, sheet_row=41, reps=8.0, reps_text="8 - 12",
              prescribed="RPE 7 - 8", logged_kg=22.0, type="CHEST/SHOULDERS",
              name="Facepulls")  # fmt: skip
    accessory = sheet.add(sheet_row=41, reps=10.0, reps_text="8 - 12", prescribed="RPE 7 - 8",
                          type="CHEST/SHOULDERS", name="Facepulls")  # fmt: skip
    rules: dict[VariantKey, Progression] = {
        (1, None): Progression("hold", "de sidste to var hårdere"),
        (4, None): Progression("step", "du ramte 12 reps to gange"),
    }
    by_row = {
        p.sheet_row: p
        for p in planned_sets(sheet.sets, CATALOG, sheet.statuses, today=TODAY, progressions=rules)
    }
    h, a = by_row[held.sheet_row], by_row[accessory.sheet_row]
    assert (h.suggested_kg, h.adjustment_kg, h.adjustment_reason) == (
        140.0,
        0.0,
        "de sidste to var hårdere",
    )
    # 22 kg + 2.5 = 24.5, on the 2.5 grid: 22.5 (rounded down, never above the cap)
    assert (a.basis, a.suggested_kg, a.adjustment_kg) == ("progression", 22.5, 2.5)
    assert (a.e1rm_kg, a.e1rm_lift) == (None, None)


def test_rest_band_and_the_warm_up_ramp_on_a_main_lifts_first_set(sheet: Sheet) -> None:
    sheet.add(week_start=LAST_WEEK, reps=3.0, prescribed="RPE 7", logged_kg=150.0)  # e1RM 180
    first = sheet.add(sheet_row=60, set_no=1, reps=3.0, prescribed="RPE 7")
    second = sheet.add(sheet_row=60, set_no=2, reps=3.0, prescribed="RPE 7")
    backoff = sheet.add(sheet_row=61, set_no=1, reps=5.0, prescribed="RPE 6")  # same run
    pull = sheet.add(sheet_row=62, set_no=1, reps=10.0, reps_text="8 - 12", prescribed="RPE 7 - 8",
                     type="UPPER BACK", name="Facepulls")  # fmt: skip
    by_key = {(p.sheet_row, p.set_no): p for p in sheet.plan()}
    top = by_key[(first.sheet_row, 1)]
    assert top.suggested_kg == 150.0  # 180 / 1.1998
    assert [(s.pct, s.reps, s.kg) for s in top.ramp or ()] == [
        (40, 5, 60.0),
        (60, 3, 90.0),
        (80, 2, 120.0),
    ]
    assert by_key[(second.sheet_row, 2)].ramp is None  # set 2
    assert by_key[(backoff.sheet_row, 1)].ramp is None  # the same exercise run
    assert by_key[(pull.sheet_row, 1)].ramp is None  # not a main lift
    assert (top.rest_min_s, top.rest_max_s) == (180, 300)  # 3 reps at RPE 7: heavy
    assert by_key[(backoff.sheet_row, 1)].rest_min_s == 180  # a main lift always rests 3-5 min
    assert by_key[(pull.sheet_row, 1)].rest_max_s == 120


def test_a_main_lift_or_its_variant_always_rests_3_to_5_minutes(sheet: Sheet) -> None:
    light_squat = sheet.add(sheet_row=70, reps=5.0, prescribed="-10%")  # no RPE, 5 reps
    tempo = sheet.add(sheet_row=71, reps=3.0, prescribed="RPE 5.5", name="3.0.0 Tempo squat")
    accessory = sheet.add(sheet_row=72, reps=10.0, reps_text="8 - 12", prescribed="RPE 7 - 8",
                          type="UPPER BACK", name="Facepulls")  # fmt: skip
    heavy_accessory = sheet.add(sheet_row=73, reps=5.0, prescribed="RPE 8", type="UPPER BACK",
                                name="Facepulls")  # fmt: skip
    by_row = {p.sheet_row: (p.rest_min_s, p.rest_max_s) for p in sheet.plan()}
    assert by_row[light_squat.sheet_row] == (180, 300)  # category main
    assert by_row[tempo.sheet_row] == (180, 300)  # a variant: parent lift SQUAT
    assert by_row[accessory.sheet_row] == (90, 120)
    assert by_row[heavy_accessory.sheet_row] == (180, 300)  # reps <= 5 at RPE >= 7


def test_a_variant_that_does_not_suggest_gets_no_kg_even_with_a_step_rule(sheet: Sheet) -> None:
    """exercise_variants.suggests = false (a multi-exercise variant such as "palloff + ghd"):
    no suggestion, and no 'progression' basis without a kg; a suggesting variant still steps."""
    catalog = Catalog(
        [lift(4, "Facepulls", None, "isolation")],
        [ExerciseVariant(id=8, exercise_id=4, name="band pull", display_name="Band pull"),
         ExerciseVariant(id=9, exercise_id=4, name="palloff + ghd", display_name="Palloff + GHD",
                         suggests=False)],
    )  # fmt: skip
    rows = {}
    for row, variant in ((41, 8), (42, 9)):
        sheet.add(week_start=LAST_WEEK, sheet_row=row, reps=10.0, prescribed="RPE 8",
                  logged_kg=22.0, type="CHEST/SHOULDERS", name="Facepulls",
                  variant_id=variant)  # fmt: skip
        rows[variant] = sheet.add(sheet_row=row, reps=10.0, prescribed="RPE 8",
                                  type="CHEST/SHOULDERS", name="Facepulls",
                                  variant_id=variant)  # fmt: skip
    rules: dict[VariantKey, Progression] = {
        (4, 8): Progression("step", "du ramte 12 reps to gange"),
        (4, 9): Progression("step", "du ramte 12 reps to gange"),
    }
    by_row = {
        p.sheet_row: p
        for p in planned_sets(sheet.sets, catalog, sheet.statuses, today=TODAY, progressions=rules)
    }
    stepped, silent = by_row[rows[8].sheet_row], by_row[rows[9].sheet_row]
    assert (stepped.basis, stepped.suggested_kg, stepped.adjustment_kg) == (
        "progression",
        22.5,
        2.5,
    )
    assert (silent.basis, silent.suggested_kg, silent.adjustment_kg) == ("no_lift", None, None)
    assert silent.adjustment_reason is None
