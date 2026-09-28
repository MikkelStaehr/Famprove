"""domain.strength: filled weeks, counted sets, STRENGTH_K, block derivation."""

from collections.abc import Callable
from datetime import date

import pytest

from conftest import BLOK_11, BLOK_12, FIXED_TODAY, SYNTHETIC_BODYWEIGHT, SYNTHETIC_SHEET_ID
from training_load.cli.collect_strength import to_domain
from training_load.domain.strength import (
    Block,
    StrengthSet,
    block_number,
    counted_sets,
    daily_strength_tss,
    derive_blocks,
    filled_weeks,
    week_starts,
)
from training_load.sources.strength_sheet import parse_all

MakeSet = Callable[..., StrengthSet]


@pytest.fixture
def workbook_sets(workbook_bytes: bytes) -> list[StrengthSet]:
    return [
        to_domain(p, SYNTHETIC_SHEET_ID) for p in parse_all(workbook_bytes, SYNTHETIC_BODYWEIGHT)
    ]


def test_block_number_parsed_from_tab_name() -> None:
    assert block_number("Program - blok 11 (hypertrofi)") == 11
    assert block_number("program -  BLOK 3") == 3


def test_block_number_raises_without_number() -> None:
    with pytest.raises(ValueError, match="numbered block"):
        block_number("Program - blok ny")


def test_week_filled_only_by_weighted_non_abs_set_with_logged_kg(make_set: MakeSet) -> None:
    sets = [
        make_set(week=1, logged_kg=100.0),
        make_set(week=2, type="ABS", logged_kg=5.0),
        make_set(week=3, bodyweight=True, logged_kg=10.0),
        make_set(week=4, logged_kg=0.0),
    ]
    assert filled_weeks(sets) == {(SYNTHETIC_SHEET_ID, BLOK_11, 1)}


def test_filled_weeks_are_scoped_per_sheet_and_tab(make_set: MakeSet) -> None:
    sets = [make_set(block=BLOK_11, week=1), make_set(block=BLOK_12, week=1, logged_kg=0.0)]
    assert filled_weeks(sets) == {(SYNTHETIC_SHEET_ID, BLOK_11, 1)}


def test_week_start_is_earliest_session_date(make_set: MakeSet) -> None:
    sets = [make_set(date=date(2026, 2, 5)), make_set(date=date(2026, 2, 2), set_no=2)]
    assert week_starts(sets) == {(SYNTHETIC_SHEET_ID, BLOK_11, 1): date(2026, 2, 2)}


def test_counted_sets_exclude_unfilled_weeks_and_future_dates(
    workbook_sets: list[StrengthSet],
) -> None:
    counted = counted_sets(workbook_sets, FIXED_TODAY)
    assert {(s.block, s.week) for s in counted} == {(BLOK_11, 1), (BLOK_12, 1)}
    # blok 12 week 2 is filled but dated 2026-03-16, after today.
    assert all(s.date <= FIXED_TODAY for s in counted)


def test_daily_strength_tss_sums_scores_times_k(workbook_sets: list[StrengthSet]) -> None:
    tss = daily_strength_tss(workbook_sets, FIXED_TODAY, k=0.02)
    # Same per-day values the original script printed for these dates (it rounded to 0.1),
    # minus the unlogged weeks it also counted (2026-02-09, 2026-02-16).
    assert tss == pytest.approx(
        {
            date(2026, 2, 2): (3 * 336.8 + 3 * 264.6 + 2 * 72.0 + 3 * 86.4) * 0.02,
            date(2026, 2, 5): (3 * 90.7 + 3 * 307.2) * 0.02,
            date(2026, 3, 9): 3 * 271.6 * 0.02,
        }
    )


def test_derive_blocks_from_workbook(workbook_sets: list[StrengthSet]) -> None:
    assert derive_blocks(workbook_sets) == [
        # Only week 1 filled; blok 12 has a filled week, so blok 11 is finished.
        Block(
            SYNTHETIC_SHEET_ID, BLOK_11, 11, date(2026, 2, 2), date(2026, 2, 8), date(2026, 2, 2)
        ),
        # Last prescribed week (2) is filled, so it is finished and week 2 is the deload.
        Block(
            SYNTHETIC_SHEET_ID, BLOK_12, 12, date(2026, 3, 9), date(2026, 3, 22), date(2026, 3, 16)
        ),
    ]


def test_ongoing_block_has_end_but_no_deload(make_set: MakeSet) -> None:
    sets = [
        make_set(week=1, date=date(2026, 2, 2)),
        make_set(week=2, date=date(2026, 2, 9)),
        make_set(week=3, date=date(2026, 2, 16), logged_kg=0.0),
    ]
    [block] = derive_blocks(sets)
    assert (block.end_date, block.deload_start) == (date(2026, 2, 15), None)


def test_block_without_filled_week_has_no_end_and_no_deload(make_set: MakeSet) -> None:
    [block] = derive_blocks([make_set(logged_kg=0.0)])
    assert (block.start_date, block.end_date, block.deload_start) == (date(2026, 2, 2), None, None)


def test_later_block_is_by_number_not_tab_order(make_set: MakeSet) -> None:
    sets = [
        make_set(block="Program - blok 9", week=1, date=date(2026, 1, 5)),
        make_set(block="Program - blok 9", week=2, date=date(2026, 1, 12), logged_kg=0.0),
        make_set(block="Program - blok 10", week=1, date=date(2026, 1, 19), logged_kg=0.0),
    ]
    # blok 10 exists but has no filled week: blok 9 is not finished yet.
    assert [b.deload_start for b in derive_blocks(sets)] == [None, None]
    started = [*sets, make_set(block="Program - blok 10", week=1, date=date(2026, 1, 19), set_no=2)]
    assert derive_blocks(started)[0].deload_start == date(2026, 1, 5)
