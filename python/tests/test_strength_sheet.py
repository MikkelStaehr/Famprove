"""Parser (sources.strength_sheet) against the synthetic workbook. Formula must stay untouched.

Golden scores were cross-checked against the original strength_collector.py (git 6810767) on
the same workbook: all 55 sets matched field by field.
"""

from datetime import date

import pytest

from conftest import BLOK_11, BLOK_11_SECTIONS, BLOK_12, SYNTHETIC_BODYWEIGHT, build_workbook
from training_load.sources.strength_sheet import (
    ParsedSet,
    cell_text,
    parse_all,
    prescribed_text,
    text_number,
)


@pytest.fixture
def parsed(workbook_bytes: bytes) -> list[ParsedSet]:
    return parse_all(workbook_bytes, SYNTHETIC_BODYWEIGHT)


def first(parsed: list[ParsedSet], block: str, name: str, week: int) -> ParsedSet:
    return next(
        p for p in parsed if p["block"] == block and p["name"] == name and p["week"] == week
    )


def test_only_program_blok_tabs_are_parsed(parsed: list[ParsedSet]) -> None:
    assert {p["block"] for p in parsed} == {BLOK_11, BLOK_12}
    assert len(parsed) == 55


def test_dates_come_from_each_day_sections_date_row(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Squat", 1)["date"] == date(2026, 2, 2)
    assert first(parsed, BLOK_11, "Squat", 3)["date"] == date(2026, 2, 16)
    # Second day section of the same week has its own date row.
    assert first(parsed, BLOK_11, "Tempo bench", 1)["date"] == date(2026, 2, 5)


def test_section_is_the_day_section_index_in_the_tab(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Squat", 1)["section"] == 1
    assert first(parsed, BLOK_11, "Leg extension", 2)["section"] == 2
    assert first(parsed, BLOK_12, "Squat", 2)["section"] == 1  # counted per tab


def test_header_micro_and_day_rows_are_skipped(parsed: list[ParsedSet]) -> None:
    assert not {p["type"] for p in parsed} & {"TYPE", "DAY", "MICRO 1"}


def test_nsets_expands_to_one_row_per_set_with_1_based_numbers(parsed: list[ParsedSet]) -> None:
    squat_w1 = [
        p for p in parsed if p["block"] == BLOK_11 and p["name"] == "Squat" and p["week"] == 1
    ]
    assert [p["set"] for p in squat_w1] == [1, 2, 3]
    assert {p["row"] for p in squat_w1} == {9}


def test_unprescribed_weeks_emit_no_sets(parsed: list[ParsedSet]) -> None:
    assert [p["week"] for p in parsed if p["name"] == "Chin-ups"] == [1, 1, 1]


def test_reps_range_uses_midpoint(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Dips", 1)["reps"] == 10.0


def test_logged_kg_excludes_bodyweight_and_kg_includes_it(parsed: list[ParsedSet]) -> None:
    dips = first(parsed, BLOK_11, "Dips", 1)
    assert (dips["logged_kg"], dips["kg"], dips["bodyweight"]) == (10.0, 90.0, True)
    squat = first(parsed, BLOK_11, "Squat", 1)
    assert (squat["logged_kg"], squat["kg"], squat["bodyweight"]) == (120.0, 120.0, False)


def test_bodyweight_param_only_changes_bodyweight_exercise_scores(workbook_bytes: bytes) -> None:
    light = parse_all(workbook_bytes, 70.0)
    heavy = parse_all(workbook_bytes, 90.0)
    changed = {a["name"] for a, b in zip(light, heavy, strict=True) if a["score"] != b["score"]}
    assert changed == {"Dips", "Chin-ups"}


def test_abs_rows_get_fixed_score_and_no_rpe(parsed: list[ParsedSet]) -> None:
    abs_sets = [p for p in parsed if p["type"] == "ABS"]
    assert abs_sets and all(p["score"] == 72.0 and p["rpe"] is None for p in abs_sets)


def test_main_lift_rpe_derived_from_e1rm_percentage(parsed: list[ParsedSet]) -> None:
    # 120 / 150 = 80 % e1RM at 5 reps -> RPE ~7.49, not the prescribed "RPE 7 - 8" (7.5).
    assert first(parsed, BLOK_11, "Squat", 1)["rpe"] == pytest.approx(7.492492, abs=1e-6)


def test_main_lift_without_kg_uses_prescribed_rpe(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Squat", 2)["rpe"] == 8.0


def test_tempo_variant_uses_prescribed_rpe(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Tempo bench", 1)["rpe"] == 6.0


def test_unknown_rpe_defaults_to_6(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Bench press", 1)["rpe"] == 6.0
    assert first(parsed, BLOK_11, "Chin-ups", 1)["rpe"] == 6.0


@pytest.mark.parametrize(
    ("block", "name", "week", "score"),
    [
        (BLOK_11, "Squat", 1, 336.8),  # leg factor 1.0, RPE from e1RM
        (BLOK_11, "Dips", 1, 264.6),  # upper-body factor 0.6, kg + bodyweight
        (BLOK_11, "Chin-ups", 1, 86.4),  # bodyweight only, RPE fallback 6
        (BLOK_11, "Tempo bench", 1, 90.7),  # tempo -> prescribed RPE
        (BLOK_11, "Leg extension", 1, 307.2),  # QUADS is a leg type
        (BLOK_11, "Squat", 2, 0.0),  # nothing logged
        (BLOK_12, "Squat", 1, 271.6),
    ],
)
def test_score_golden_values_regression(
    parsed: list[ParsedSet], block: str, name: str, week: int, score: float
) -> None:
    assert first(parsed, block, name, week)["score"] == score


def test_prescribed_load_cell_is_passed_through_as_text(parsed: list[ParsedSet]) -> None:
    assert first(parsed, BLOK_11, "Squat", 1)["prescribed"] == "RPE 7 - 8"
    assert first(parsed, BLOK_11, "Bench press", 1)["prescribed"] == "-10%"
    assert first(parsed, BLOK_11, "Abs rollout", 1)["prescribed"] is None


@pytest.mark.parametrize(
    ("cell", "text"),
    [
        ("RPE 6 - 7", "RPE 6 - 7"),
        (" BW ", "BW"),
        (-0.1, "-10%"),
        (-0.125, "-12.5%"),
        (100, "100"),
        ("", None),
        (None, None),
    ],
)
def test_prescribed_text_shows_the_cell_as_the_sheet_does(cell: object, text: str | None) -> None:
    assert prescribed_text(cell) == text


def test_sets_and_reps_cells_are_passed_through_as_written(parsed: list[ParsedSet]) -> None:
    dips = first(parsed, BLOK_11, "Dips", 1)
    assert (dips["sets_text"], dips["reps_text"], dips["reps"]) == ("3", "8 - 12", 10.0)
    squat = first(parsed, BLOK_11, "Squat", 1)
    assert (squat["sets_text"], squat["reps_text"]) == ("3", "5")


@pytest.mark.parametrize(
    ("cell", "text"),
    [(3.0, "3"), (2, "2"), (" 8 - 12 ", "8 - 12"), (12.5, "12.5"), ("", None), (None, None)],
)
def test_cell_text_shows_numbers_without_trailing_zeros(cell: object, text: str | None) -> None:
    assert cell_text(cell) == text


def test_text_number_reads_numbers_typed_as_text() -> None:
    assert text_number("137.5") == 137.5
    assert text_number("137,5") == 137.5
    assert text_number(" 140 ") == 140.0
    assert text_number(125) == 125  # numbers pass through
    for keep in ("BW", "137.5 kg", "", None, "RPE 7"):
        assert text_number(keep) == keep


def test_kg_typed_as_text_parses_like_numbers() -> None:
    """The sheet's WEIGHT column can be formatted as text: "120", "70,0" and "10.0" must give
    the same sets (and scores) as the numbers 120, 70 and 10."""
    (dates_1, rows_1), (dates_2, rows_2) = BLOK_11_SECTIONS
    squat, dips, *rest_1 = rows_1
    tempo, *rest_2 = rows_2
    as_text = [
        (
            dates_1,
            [
                (squat[0], squat[1], [("3", "5", "RPE 7 - 8", "120"), *squat[2][1:]]),
                (dips[0], dips[1], [(3, "8 - 12", "RPE 7", "10.0"), *dips[2][1:]]),
                *rest_1,
            ],
        ),
        (dates_2, [(tempo[0], tempo[1], [(3, 6, "RPE 6", "70,0"), *tempo[2][1:]]), *rest_2]),
    ]
    typed = parse_all(build_workbook(as_text), SYNTHETIC_BODYWEIGHT)
    numeric = parse_all(build_workbook(), SYNTHETIC_BODYWEIGHT)
    assert typed == numeric
    assert first(typed, BLOK_11, "Squat", 1)["logged_kg"] == 120.0
