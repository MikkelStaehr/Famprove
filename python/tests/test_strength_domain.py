"""domain.strength: session numbering, filled weeks, block derivation."""

from collections.abc import Callable
from datetime import date

import pytest

from conftest import BLOK_11, BLOK_12, FIXED_TODAY, SYNTHETIC_BODYWEIGHT, SYNTHETIC_SHEET_ID
from training_load.cli.collect_strength import section_key, to_domain
from training_load.domain.strength import (
    Block,
    SessionSlot,
    StrengthSet,
    block_number,
    derive_blocks,
    filled_weeks,
    has_block_number,
    iso_week_start,
    number_sessions,
    shared_weeks,
    week_starts,
)
from training_load.sources.strength_sheet import parse_all

MakeSet = Callable[..., StrengthSet]


@pytest.fixture
def workbook_sets(workbook_bytes: bytes) -> list[StrengthSet]:
    parsed = parse_all(workbook_bytes, SYNTHETIC_BODYWEIGHT)
    slots = number_sessions((section_key(p), p["date"]) for p in parsed)
    return [to_domain(p, SYNTHETIC_SHEET_ID, slots[section_key(p)]) for p in parsed]


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


def test_week_start_is_the_earliest_iso_week_start(make_set: MakeSet) -> None:
    sets = [make_set(week_start=date(2026, 2, 9)), make_set(week_start=date(2026, 2, 2), set_no=2)]
    assert week_starts(sets) == {(SYNTHETIC_SHEET_ID, BLOK_11, 1): date(2026, 2, 2)}


def test_iso_week_start_is_monday() -> None:
    assert iso_week_start(date(2026, 10, 4)) == date(2026, 9, 28)  # Sunday -> Monday
    assert iso_week_start(date(2026, 9, 28)) == date(2026, 9, 28)


def test_workbook_sections_become_sessions_per_iso_week(workbook_sets: list[StrengthSet]) -> None:
    slots = {(s.block, s.week, s.name): (s.week_start, s.session) for s in workbook_sets}
    assert slots[(BLOK_11, 1, "Squat")] == (date(2026, 2, 2), 1)
    assert slots[(BLOK_11, 1, "Tempo bench")] == (date(2026, 2, 2), 2)
    assert slots[(BLOK_11, 3, "Tempo bench")] == (date(2026, 2, 16), 2)
    assert slots[(BLOK_12, 2, "Squat")] == (date(2026, 3, 16), 1)


def test_sessions_follow_sheet_order_skipping_sections_without_sets() -> None:
    blok12 = "Program - blok 12"
    monday, wednesday, friday = date(2026, 9, 28), date(2026, 9, 30), date(2026, 10, 2)
    slots = number_sessions(
        [
            ((blok12, 1, 1), monday),
            ((blok12, 1, 3), friday),
            ((blok12, 1, 2), wednesday),
            ((blok12, 2, 1), date(2026, 10, 5)),
            ((blok12, 2, 3), date(2026, 10, 9)),
        ]
    )
    assert [slots[(blok12, 1, n)].session for n in (1, 2, 3)] == [1, 2, 3]
    # Week 2 prescribes nothing in section 2: its sections 1 and 3 are sessions 1 and 2.
    assert slots[(blok12, 2, 3)] == SessionSlot(date(2026, 10, 5), 2)


def test_blok_11_numbers_1_to_2_and_blok_12_numbers_1_to_3() -> None:
    blok11, blok12 = "Program - blok 11", "Program - blok 12"
    sections = [((blok11, 1, n), date(2026, 8, 10)) for n in (1, 2)]  # DAY 1, DAY 5
    sections += [((blok12, 1, n), date(2026, 9, 28)) for n in (1, 2, 3)]  # DAY 1, 3, 5
    slots = number_sessions(sections)
    assert sorted(s.session for k, s in slots.items() if k[0] == blok11) == [1, 2]
    assert sorted(s.session for k, s in slots.items() if k[0] == blok12) == [1, 2, 3]


def test_session_slot_ignores_the_weekday_of_the_sheet_dates() -> None:
    blok = "Program - blok 12"
    as_written = number_sessions(
        [((blok, 1, 1), date(2026, 9, 28)), ((blok, 1, 2), date(2026, 10, 2))]
    )
    moved = number_sessions([((blok, 1, 1), date(2026, 9, 30)), ((blok, 1, 2), date(2026, 9, 29))])
    assert as_written == moved


def test_two_tabs_in_one_week_are_numbered_by_block_number() -> None:
    week = date(2026, 5, 4)
    slots = number_sessions(
        [(("Program - blok 10", 4, 1), week), (("Program - blok 9", 6, 1), week)]
    )
    assert slots[("Program - blok 9", 6, 1)].session == 1
    assert slots[("Program - blok 10", 4, 1)].session == 2
    assert shared_weeks(slots) == [week]


LATER = date(2026, 12, 31)


def test_derive_blocks_from_workbook(workbook_sets: list[StrengthSet]) -> None:
    assert derive_blocks(workbook_sets, FIXED_TODAY) == [
        # Only week 1 filled; blok 12 has a filled week, so blok 11 is finished.
        Block(
            SYNTHETIC_SHEET_ID, BLOK_11, 11, date(2026, 2, 2), date(2026, 2, 8), date(2026, 2, 2)
        ),
        # Week 2 has kg but starts after today, so it is not filled yet: ongoing, no deload.
        Block(SYNTHETIC_SHEET_ID, BLOK_12, 12, date(2026, 3, 9), date(2026, 3, 15), None),
    ]


def test_ongoing_block_has_end_but_no_deload(make_set: MakeSet) -> None:
    sets = [
        make_set(week=1, week_start=date(2026, 2, 2)),
        make_set(week=2, week_start=date(2026, 2, 9)),
        make_set(week=3, week_start=date(2026, 2, 16), logged_kg=0.0),
    ]
    [block] = derive_blocks(sets, LATER)
    assert (block.end_date, block.deload_start) == (date(2026, 2, 15), None)


def test_block_without_filled_week_has_no_end_and_no_deload(make_set: MakeSet) -> None:
    [block] = derive_blocks([make_set(logged_kg=0.0)], LATER)
    assert (block.start_date, block.end_date, block.deload_start) == (date(2026, 2, 2), None, None)


def test_later_block_is_by_number_not_tab_order(make_set: MakeSet) -> None:
    sets = [
        make_set(block="Program - blok 9", week=1, week_start=date(2026, 1, 5)),
        make_set(block="Program - blok 9", week=2, week_start=date(2026, 1, 12), logged_kg=0.0),
        make_set(block="Program - blok 10", week=1, week_start=date(2026, 1, 19), logged_kg=0.0),
    ]
    # blok 10 exists but has no filled week: blok 9 is not finished yet.
    assert [b.deload_start for b in derive_blocks(sets, LATER)] == [None, None]
    started = [
        *sets,
        make_set(block="Program - blok 10", week=1, week_start=date(2026, 1, 19), set_no=2),
    ]
    assert derive_blocks(started, LATER)[0].deload_start == date(2026, 1, 5)


def test_kg_logged_ahead_of_time_does_not_end_a_block(make_set: MakeSet) -> None:
    sets = [
        make_set(week=1, week_start=date(2026, 2, 2)),
        make_set(week=2, week_start=date(2026, 2, 9)),  # last prescribed week, entered early
    ]
    [before] = derive_blocks(sets, today=date(2026, 2, 8))
    assert (before.end_date, before.deload_start) == (date(2026, 2, 8), None)
    [after] = derive_blocks(sets, today=date(2026, 2, 9))
    assert (after.end_date, after.deload_start) == (date(2026, 2, 15), date(2026, 2, 9))


def test_has_block_number() -> None:
    assert has_block_number("Program - blok 12 (styrke)")
    assert not has_block_number("Program - blok skabelon")
