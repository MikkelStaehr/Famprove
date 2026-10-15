"""The sheet's layout guard (user, 2026-10-15, slice sheet-layout): a week's columns come from the
header row, a training day runs from the header under its WEEK row to the next Micro Length, DAY or
MICROCYCLE row, and anything the parser can't place stops the run with the tab and row."""

import io
from datetime import datetime, timedelta

import openpyxl
import pytest

from training_load.domain.exercises import Scoring
from training_load.sources.strength_sheet import SheetLayoutError, parse_all

TAB = "Program - blok 12 x"
HEADER: list[object] = ["SETS", "REPS", "LOAD", "WEIGHT", "LSRPE", "NOTES", "Mean Weight", None]
END: list[object] = [None, None, None, None, "MICROCYCLE SBD METRICS"]


def plain(_t: str, _n: str, _v: str | None = None) -> Scoring:
    return Scoring(0.6, None)


def week_row(day: int) -> list[object]:
    row: list[object] = [None] * 20
    row[1] = datetime(2026, 9, 28) + timedelta(days=day)
    for w in range(2):
        row[4 + 8 * w] = f"WEEK {w + 1}"
        row[6 + 8 * w] = datetime(2026, 9, 28) + timedelta(days=day + 7 * w)
    return row


def header(week_2: list[object] | None = None) -> list[object]:
    return [None, "TYPE", "NAME", None, *HEADER, *(week_2 or HEADER)]


def exercise(name: str, kg: float = 20.0, typ: str = "QUADS") -> list[object]:
    return [None, typ, name, None, *[2, 10, "RPE 8", kg, None, None, None, None] * 2]


def workbook(rows: list[list[object]]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = TAB
    ws.append([None, "ATHLETE:", None])  # the tab's top block, before day 1
    ws.append([None, "LB ROUNDING:", 5.0])
    for r in rows:
        ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def day(n: int, *exercises: list[object]) -> list[list[object]]:
    """A day block as the template writes it: Micro Length, DAY n, WEEK row, header, exercises."""
    return [[None, "Micro Length", datetime(1900, 1, 8 - n)], [None, "DAY", n], week_row(n),
            header(), *exercises]  # fmt: skip


def test_days_end_at_micro_length_day_and_microcycle_rows() -> None:
    sets = parse_all(
        workbook([*day(1, exercise("Leg press")), *day(2, exercise("Leg curl")), END]), plain
    )
    assert sorted({(p["section"], p["name"]) for p in sets}) == [(1, "Leg press"), (2, "Leg curl")]


def test_an_exercise_row_below_the_last_day_stops_the_run() -> None:
    """The coach's exercise library pasted under the last day must never become sets."""
    rows: list[list[object]] = [*day(1, exercise("Leg press")), END, [], exercise("Nordic curl")]
    with pytest.raises(
        SheetLayoutError, match=r"row 10: an exercise row \('QUADS', 'Nordic curl'\)"
    ):
        parse_all(workbook(rows), plain)


def test_a_day_without_an_end_stops_the_run() -> None:
    with pytest.raises(SheetLayoutError, match=r"training day from row 6 has no end"):
        parse_all(workbook(day(1, exercise("Leg press"))), plain)


def test_a_new_week_row_inside_an_open_day_stops_the_run() -> None:
    rows: list[list[object]] = [
        *day(1, exercise("Leg press")),
        week_row(2),
        header(),
        exercise("Leg curl"),
        END,
    ]
    with pytest.raises(SheetLayoutError, match=r"row 8: a new WEEK row, but the training day"):
        parse_all(workbook(rows), plain)


def test_a_header_row_must_sit_directly_under_its_week_row() -> None:
    rows: list[list[object]] = [
        [None, "DAY", 1],
        week_row(1),
        [],
        header(),
        exercise("Leg press"),
        END,
    ]
    with pytest.raises(SheetLayoutError, match=r"row 4: no header row"):
        parse_all(workbook(rows), plain)
    rows = [*day(1, exercise("Leg press")), header(), END]
    with pytest.raises(SheetLayoutError, match=r"row 8: a header row that isn't directly under"):
        parse_all(workbook(rows), plain)


def test_a_week_without_one_of_its_columns_stops_the_run() -> None:
    week_2: list[object] = [
        "SETS",
        "REPS",
        "LOAD",
        "WEIGHT",
        "LSRPE",
        "Comments",
        "Mean Weight",
        None,
    ]
    rows: list[list[object]] = [
        [None, "DAY", 1],
        week_row(1),
        header(week_2),
        exercise("Leg press"),
        END,
    ]
    with pytest.raises(SheetLayoutError, match=r"row 5: week 2 has no NOTES column"):
        parse_all(workbook(rows), plain)


def test_columns_are_found_by_their_header_not_their_position() -> None:
    """Week 2 with WEIGHT and LOAD swapped: kg and the prescription still come from their own."""
    week_2: list[object] = ["SETS", "REPS", "WEIGHT", "LOAD", "LSRPE", "NOTES", "Mean Weight", None]
    row = exercise("Leg press")
    row[4 + 8 + 2], row[4 + 8 + 3] = 30.0, "RPE 7"  # week 2 as its header reads
    rows: list[list[object]] = [[None, "DAY", 1], week_row(1), header(week_2), row, END]
    by_week = {p["week"]: p for p in parse_all(workbook(rows), plain)}
    assert (by_week[1]["logged_kg"], by_week[1]["prescribed"]) == (20.0, "RPE 8")
    assert (by_week[2]["logged_kg"], by_week[2]["prescribed"]) == (30.0, "RPE 7")
    assert by_week[2]["raw"]["weight"] == 30.0 and by_week[2]["raw"]["load"] == "RPE 7"


def test_a_note_starting_with_microcycle_never_ends_the_day() -> None:
    """Only a row that isn't an exercise can be the MICROCYCLE end marker (reviewer, 2026-10-15)."""
    noted = exercise("Leg curl")
    noted[4 + 5] = "Microcycle note: go easy"  # week 1's NOTES
    rows: list[list[object]] = [*day(1, exercise("Leg press"), noted), END]
    assert sorted({p["name"] for p in parse_all(workbook(rows), plain)}) == [
        "Leg curl",
        "Leg press",
    ]


def test_a_day_not_dated_yet_gives_no_sets_and_stops_nothing() -> None:
    """A block laid out but not dated yet (no date in column B) reads as before: no sets."""
    undated = week_row(1)
    undated[1] = None
    rows: list[list[object]] = [[None, "DAY", 1], undated, header(), exercise("Leg press"),
                                *day(2, exercise("Leg curl")), END]  # fmt: skip
    assert {p["name"] for p in parse_all(workbook(rows), plain)} == {"Leg curl"}


def test_a_tab_without_a_block_number_never_stops_the_run() -> None:
    """The caller drops such a tab anyway (counts_issues False), so its layout stops nothing."""
    broken = workbook(day(1, exercise("Leg press")))  # a day without an end
    assert parse_all(broken, plain, counts_issues=lambda _tab: False) == []
    with pytest.raises(SheetLayoutError):
        parse_all(broken, plain, counts_issues=lambda _tab: True)
