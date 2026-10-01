"""domain.strength_analysis (status, phase, e1RM, weekly rows), domain.kg_history and the
parser's LSRPE / raw cells. Synthetic values only."""

from collections import Counter
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import openpyxl
import pytest

from training_load.domain.kg_history import KgState, gone_states, kg_keys, next_kg_state
from training_load.domain.strength import Block, StrengthSet
from training_load.domain.strength_analysis import (
    E1RM_FACTOR,
    KgStatus,
    StrengthWeek,
    e1rm,
    kg_status,
    kg_statuses,
    phase_of,
    set_key,
    strength_weeks,
)
from training_load.sources.strength_sheet import (
    LSRPE_COLUMN_MISSING,
    LSRPE_NOT_HALF,
    logged_rpe,
    parse_tab,
)

MakeSet = Callable[..., StrengthSet]
B11, B12 = "Program - blok 11", "Program - blok 12 (offseason)"
W1 = date(2026, 8, 10)  # a Monday
TODAY = date(2026, 10, 1)
NOW = datetime(2026, 10, 1, 3, 0, tzinfo=UTC)


def top(make_set: MakeSet, **changes: object) -> StrengthSet:
    """A lifted-looking competition top set: Squat 1 x 5 @ RPE 6.5, 140 kg."""
    values: dict[str, object] = {
        "block": B11,
        "week_start": W1,
        "session": 1,
        "type": "SQUAT",
        "name": "Squat",
        "reps": 5.0,
        "logged_kg": 140.0,
        "prescribed": "RPE 6.5",
    }
    return make_set(**(values | changes))


# --- parser: LSRPE -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cell", "expected", "counted"),
    [
        (None, None, 0),
        ("", None, 0),
        ("  ", None, 0),
        (7, 7.0, 0),
        (7.5, 7.5, 0),
        ("7", 7.0, 0),
        ("7,5", 7.5, 0),
        ("7.5", 7.5, 0),
        ("7.8", None, 1),  # not a whole or half value
        (11, None, 1),
        (0.5, None, 1),
        ("x", None, 1),
        (True, None, 1),
    ],
)
def test_logged_rpe(cell: object, expected: float | None, counted: int) -> None:
    issues: Counter[str] = Counter()
    assert logged_rpe(cell, issues) == expected
    assert issues[LSRPE_NOT_HALF] == counted


# --- status and phase ----------------------------------------------------------------------


def test_kg_status(make_set: MakeSet) -> None:
    b11_ended = top(make_set)
    b11_this_week = top(make_set, week_start=date(2026, 9, 28))
    b12_ended = top(make_set, block=B12, week_start=date(2026, 9, 21))
    assert kg_status(b11_ended, done=True, today=TODAY) == "lifted"
    assert kg_status(b11_ended, done=False, today=TODAY) == "pre_log"
    assert kg_status(b11_this_week, done=False, today=TODAY) == "planned"  # week not over
    assert kg_status(b12_ended, done=False, today=TODAY) == "planned"  # after the log began
    assert kg_status(b12_ended, done=True, today=TODAY) == "lifted"


def test_phase_of() -> None:
    assert [phase_of(n) for n in (1, 11, 12, 13)] == [
        "in_season",
        "in_season",
        "off_season",
        "off_season",  # inherited (compute logs it)
    ]


# --- e1RM and weekly rows ------------------------------------------------------------------


def test_e1rm_is_the_inverse_of_the_plan_formula() -> None:
    one_rm = 180.0
    planned = one_rm / (1 + E1RM_FACTOR * (5 + 10 - 6.5))  # planned_load's rpe_e1rm rule
    assert e1rm(planned, 5, 6.5) == pytest.approx(one_rm)


def blocks() -> list[Block]:
    return [
        Block("s", B11, 11, W1, W1 + timedelta(days=27), None),
        Block("s", B12, 12, date(2026, 9, 28), date(2026, 10, 4), None),
    ]


def analyse(
    sets: list[StrengthSet], status: KgStatus = "pre_log", today: date = date(2026, 8, 30)
) -> dict[tuple[date, str], StrengthWeek]:
    statuses = {set_key(s): status for s in sets}
    weeks = strength_weeks(sets, statuses, blocks(), today=today).weeks
    return {(w.week_start, w.lift): w for w in weeks}


def test_only_competition_rpe_sets_give_an_e1rm(make_set: MakeSet) -> None:
    excluded = [
        top(make_set, sheet_row=2, name="3.2.0 Tempo squat"),  # variant
        top(make_set, sheet_row=3, prescribed="-10%", logged_kg=126.0),  # back-off
        top(make_set, sheet_row=4, prescribed="75%"),  # % of the tab's 1RM: circular
        top(make_set, sheet_row=5, reps=10.0),  # above MAX_E1RM_REPS
        top(make_set, sheet_row=6, logged_kg=None),  # nothing entered
    ]
    week = analyse(excluded)[(W1, "SQUAT")]
    assert week.e1rm_kg is None and week.e1rm_rpe_source is None
    assert week.sets_lifted == 4  # all but the empty one
    assert week.tonnage_kg == pytest.approx(140 * 5 * 2 + 126 * 5 + 140 * 10)


def test_the_week_takes_its_best_set_and_logged_rpe_wins(make_set: MakeSet) -> None:
    prescribed_only = analyse([top(make_set), top(make_set, sheet_row=2, logged_kg=145.0)])
    best = prescribed_only[(W1, "SQUAT")]
    assert best.e1rm_load_kg == 145.0 and best.e1rm_rpe_source == "prescribed"
    assert best.e1rm_kg == pytest.approx(e1rm(145.0, 5, 6.5))

    mixed = analyse([top(make_set, logged_rpe=8.0), top(make_set, sheet_row=2, logged_kg=150.0)])
    logged = mixed[(W1, "SQUAT")]
    assert logged.e1rm_rpe_source == "logged" and logged.e1rm_load_kg == 140.0
    assert logged.e1rm_kg == pytest.approx(e1rm(140.0, 5, 8.0))


def test_planned_sets_never_count_and_every_week_has_a_row(make_set: MakeSet) -> None:
    weeks = analyse([top(make_set)], status="planned")
    assert len(weeks) == 3 * 3  # W1 .. the week of 30 Aug, x 3 lifts
    assert all(w.sets_lifted == 0 and w.tonnage_kg == 0 for w in weeks.values())
    assert all(w.status is None and w.e1rm_kg is None for w in weeks.values())


def test_block_best_phase_and_weeks_between_blocks(make_set: MakeSet) -> None:
    sets = [
        top(make_set, logged_kg=140.0),
        top(make_set, week=2, week_start=W1 + timedelta(days=7), logged_kg=150.0),
        top(make_set, week=3, week_start=W1 + timedelta(days=14), logged_kg=150.0),  # tie
        top(make_set, block=B12, week_start=date(2026, 9, 28), logged_kg=130.0),
    ]
    weeks = analyse(sets, today=TODAY)
    squat = {k[0]: w for k, w in weeks.items() if k[1] == "SQUAT"}
    assert [d for d, w in squat.items() if w.is_block_best] == [
        W1 + timedelta(days=7),  # the earliest of the tie
        date(2026, 9, 28),
    ]
    assert squat[W1].phase == "in_season" and squat[date(2026, 9, 28)].phase == "off_season"
    gap = squat[date(2026, 9, 14)]  # between the blocks
    assert (gap.block, gap.phase, gap.sets_lifted) == (None, None, 0)


def test_an_implausible_e1rm_is_left_out_and_counted(make_set: MakeSet) -> None:
    sets = [top(make_set, logged_kg=600.0), top(make_set, sheet_row=2, logged_kg=140.0)]
    result = strength_weeks(
        sets, {set_key(s): "pre_log" for s in sets}, blocks(), today=date(2026, 8, 16)
    )
    first = next(w for w in result.weeks if w.lift == "SQUAT")
    assert first.e1rm_load_kg == 140.0 and result.e1rm_out_of_bounds == 1


def test_statuses_use_the_matched_sessions(make_set: MakeSet) -> None:
    s1, s2 = (
        top(make_set, block=B12, week_start=date(2026, 9, 28)),
        top(make_set, block=B12, week_start=date(2026, 9, 28), session=2, sheet_row=2),
    )
    statuses = kg_statuses([s1, s2], {(date(2026, 9, 28), 1)}, TODAY)
    assert (statuses[set_key(s1)], statuses[set_key(s2)]) == ("lifted", "planned")


# --- kg history ----------------------------------------------------------------------------


def run(
    make_set: MakeSet, steps: list[tuple[float | None, KgStatus]], **changes: object
) -> list[KgState]:
    states: list[KgState] = []
    prev = None
    for i, (kg, status) in enumerate(steps):
        s = top(make_set, logged_kg=kg, **changes)
        key = kg_keys([s])[set_key(s)]
        prev = next_kg_state(prev, s, key, status, NOW + timedelta(hours=i))
        states.append(prev)
    return states


def test_planned_first_and_last_then_lifted_follows_corrections(make_set: MakeSet) -> None:
    states = run(
        make_set,
        [
            (140.0, "planned"),
            (145.0, "planned"),
            (142.5, "lifted"),
            (142.5, "lifted"),
            (143.0, "lifted"),
        ],
    )
    first, revised, done, same, corrected = states
    assert (first.planned_first_kg, first.planned_last_kg) == (140.0, 140.0)
    assert (revised.planned_first_kg, revised.planned_last_kg) == (140.0, 145.0)
    assert revised.planned_last_at == NOW + timedelta(hours=1)
    assert (done.planned_last_kg, done.lifted_kg) == (145.0, 142.5)  # plan frozen
    assert done.lifted_first_at == NOW + timedelta(hours=2) and done.lifted_changed_at is None
    assert same == done  # nothing changed: nothing to write
    assert corrected.lifted_kg == 143.0 and corrected.lifted_changed_at == NOW + timedelta(hours=4)
    assert corrected.planned_first_kg == 140.0 and corrected.first_seen_at == NOW


def test_first_seen_after_the_session_leaves_planned_null(make_set: MakeSet) -> None:
    [pre_log] = run(make_set, [(140.0, "pre_log")])
    assert pre_log.planned_first_kg is None and pre_log.planned_last_kg is None
    assert pre_log.lifted_kg == 140.0


def test_unmatched_after_done_clears_lifted_and_keeps_the_plan_frozen(make_set: MakeSet) -> None:
    *_, unmatched, replanned = run(
        make_set, [(140.0, "planned"), (142.5, "lifted"), (142.5, "planned"), (150.0, "planned")]
    )
    assert unmatched.lifted_kg is None and unmatched.lifted_first_at is not None
    assert replanned.planned_last_kg == 140.0  # frozen at the first completion


def test_an_inserted_row_keeps_the_history_and_a_rename_never_overwrites(
    make_set: MakeSet,
) -> None:
    week = [top(make_set, sheet_row=10), top(make_set, sheet_row=12, name="Bænk", type="BENCH")]
    keys = kg_keys(week)
    states = {
        keys[set_key(x)]: next_kg_state(None, x, keys[set_key(x)], "planned", NOW) for x in week
    }
    # The coach inserts an accessory row above: both sets move down one row.
    moved = [replace(x, sheet_row=x.sheet_row + 1) for x in week]
    later = NOW + timedelta(days=1)
    moved_keys = kg_keys(moved)
    assert set(moved_keys.values()) == set(keys.values())  # same keys: the history continues
    for x in moved:
        k = moved_keys[set_key(x)]
        after = next_kg_state(states[k], x, k, "lifted", later)
        assert after.planned_first_kg == 140.0 and after.lifted_kg == 140.0
        assert after.sheet_row == x.sheet_row and after.first_seen_at == NOW
    renamed = replace(week[0], name="Pause squat")  # same row, another exercise: a new key
    assert kg_keys([renamed])[set_key(renamed)] not in states


def test_a_top_set_and_a_backoff_never_swap_when_a_same_name_row_is_inserted(
    make_set: MakeSet,
) -> None:
    top_set = top(make_set, sheet_row=5)
    backoff = top(make_set, sheet_row=6, prescribed="-10%", logged_kg=126.0)
    before = kg_keys([top_set, backoff])
    # The coach inserts another "Squat" row above both: rows shift, the keys don't.
    extra = top(make_set, sheet_row=5, prescribed="RPE 7")
    shifted = [replace(top_set, sheet_row=6), replace(backoff, sheet_row=7)]
    after = kg_keys([extra, *shifted])
    assert after[set_key(shifted[0])] == before[set_key(top_set)]
    assert after[set_key(shifted[1])] == before[set_key(backoff)]
    assert after[set_key(extra)] not in before.values()
    twins = [top(make_set, sheet_row=8), top(make_set, sheet_row=9)]  # identical rows
    twin_keys = kg_keys(twins)
    assert [twin_keys[set_key(t)][6] for t in twins] == [1, 2]  # occurrence in sheet order


def test_a_set_that_leaves_the_sheet_is_marked_gone_and_cleared_when_back(
    make_set: MakeSet,
) -> None:
    s = top(make_set)
    key = kg_keys([s])[set_key(s)]
    stored = {key: next_kg_state(None, s, key, "planned", NOW)}
    [gone] = gone_states(stored, set(), NOW + timedelta(days=1))
    assert gone.gone_at == NOW + timedelta(days=1) and gone.planned_first_kg == 140.0
    assert gone_states({key: gone}, set(), NOW + timedelta(days=2)) == []  # already gone
    back = next_kg_state(gone, s, key, "planned", NOW + timedelta(days=3))
    assert back.gone_at is None and back.planned_first_kg == 140.0


def test_empty_kg_records_nothing(make_set: MakeSet) -> None:
    [planned, done] = run(make_set, [(None, "planned"), (None, "lifted")])
    assert (
        planned.planned_first_kg is None and done.lifted_kg is None and done.lifted_first_at is None
    )
    assert replace(done) == done


def test_a_tab_without_any_header_row_counts_the_missing_lsrpe_column() -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    date_row: list[object] = [
        None,
        datetime(2026, 8, 10),
        None,
        None,
        "WEEK 1",
        None,
        datetime(2026, 8, 10),
    ]
    ws.append(date_row)
    ws.append(
        [None, "SQUAT", "Squat", None, 1, 5, "RPE 6", 140, 7]
    )  # an LSRPE-like cell, no header
    issues: Counter[str] = Counter()
    [parsed] = parse_tab(ws, "Program - blok 12", 80.0, issues)
    assert parsed["logged_rpe"] is None and issues[LSRPE_COLUMN_MISSING] == 1
