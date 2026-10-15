"""Exercise variants from "V:" lines in the sheet's NOTES (user, 2026-10-14): parsing,
carry-forward, runs, the catalogue's inheritance, collect-strength's insert-only, and the
per-variant grouping."""

import io
from collections import Counter
from datetime import date, datetime

import openpyxl

from conftest import InMemoryPostgrest
from training_load.db.exercise_variants import add_unknown_variants, all_variants
from training_load.domain.exercises import Catalog, Exercise, ExerciseVariant, Scoring, variant_key
from training_load.domain.set_feedback import LoggedSet, progressions
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import e1rm_point
from training_load.sources.strength_sheet import (
    VARIANT_EMPTY,
    VARIANT_TWICE,
    notes_text,
    parse_all,
    row_variants,
    split_notes,
)

# --- split_notes / variant_key (edge cases 1-10) ------------------------------------------------


def test_a_v_line_names_the_variant_and_the_rest_is_the_note() -> None:
    assert split_notes("V: DB Preacher Curl") == ("DB Preacher Curl", None, 0)
    assert split_notes("variant:  Kabel   curl")[0] == "Kabel   curl"
    assert variant_key("  Kabel   CURL ") == "kabel curl"
    assert split_notes("V : x")[0] == "x"
    assert split_notes("Pause i bunden\nV: Tempo") == ("Tempo", "Pause i bunden", 0)
    assert split_notes("V: Tempo\nPause i bunden") == ("Tempo", "Pause i bunden", 0)
    assert split_notes("V: Tempo\r\nPause\rTo sek") == ("Tempo", "Pause\nTo sek", 0)


def test_empty_and_double_v_lines_and_lookalikes() -> None:
    assert split_notes("V:") == ("", None, 0)
    assert split_notes("V: A\nV: B") == ("A", None, 1)
    for note in ("Vægt: 5", "NB: V-grip", "Variation af squat"):
        assert split_notes(note) == (None, note, 0)
    assert split_notes(5)[0] is None


def test_the_note_never_shows_the_v_line() -> None:
    assert notes_text({"notes": "V: DB curl\nLangsomt ned"}) == "Langsomt ned"
    assert notes_text({"notes": "V: DB curl"}) is None


# --- carry-forward (11, 14) -----------------------------------------------------------------------


def _row(name: str, notes: dict[int, str]) -> list[object]:
    """A sheet row with NOTES per week (0-based week -> text) at the template's columns."""
    row: list[object] = [None, "BICEPS", name, None]
    row += [None] * (8 * 6)
    for w, text in notes.items():
        row[4 + 8 * w + 5] = text
    return row


def notes(weeks: int) -> list[int]:
    """Each week's NOTES column in the template (the parser takes them from the header row)."""
    return [4 + 8 * w + 5 for w in range(weeks)]


def test_a_variant_holds_from_its_week_until_the_next_and_the_own_name_resets() -> None:
    issues: Counter[str] = Counter()
    states, named = row_variants(
        _row("Bicep of choice", {2: "V: Kabel curl", 4: "V: DB curl"}),
        "Bicep of choice",
        notes(6),
        issues,
    )
    assert [s[0] if s else None for s in states] == [
        None,
        None,
        "kabel curl",
        "kabel curl",
        "db curl",
        "db curl",
    ]
    assert named == [False, False, True, False, True, False]
    states, _ = row_variants(
        _row("Bicep of choice", {0: "V: Kabel curl", 2: "V: bicep of choice"}),
        "Bicep of choice",
        notes(4),
        issues,
    )
    assert [s[0] if s else None for s in states] == ["kabel curl", "kabel curl", None, None]
    states, _ = row_variants(
        _row("Bicep of choice", {0: "V: Kabel curl", 1: "V:", 2: "V: A\nV: B"}),
        "Bicep of choice",
        notes(3),
        issues,
    )
    assert [s[0] if s else None for s in states] == ["kabel curl", "kabel curl", "a"]
    assert issues[VARIANT_EMPTY] == 1 and issues[VARIANT_TWICE] == 1


# --- parse_all: runs and a new tab (12, 13) ------------------------------------------------------


def _workbook(tabs: dict[str, list[list[object]]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.worksheets[0])
    for tab, rows in tabs.items():
        ws = wb.create_sheet(tab)
        ws.append([None, "SQUAT", None, None, None, None, 150])
        ws.append([])
        ws.append([None, "DAY", "Day 1"])
        date_row: list[object] = [None] * (4 + 8 * 3)
        date_row[1] = datetime(2026, 9, 7)
        for w in range(3):
            date_row[4 + 8 * w] = f"WEEK {w + 1}"
            date_row[6 + 8 * w] = datetime(2026, 9, 7 + 7 * w)
        ws.append(date_row)
        header: list[object] = [None, "TYPE", "NAME", None]
        for _ in range(3):
            header += ["SETS", "REPS", "LOAD", "WEIGHT", "LSRPE", "NOTES", "Mean Weight", None]
        ws.append(header)
        for r in rows:
            ws.append(r)
        ws.append([None, None, None, None, "MICROCYCLE SBD METRICS"])  # the last day's end
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _sets_row(name: str, notes: dict[int, str]) -> list[object]:
    row: list[object] = [None, "BICEPS", name, None]
    for w in range(3):
        row += [2, 10, "RPE 8", 10, None, notes.get(w), None, None]
    return row


def test_a_run_follows_its_head_and_a_new_tab_starts_unknown() -> None:
    xlsx = _workbook({
        "Program - blok 11 x": [
            _sets_row("Bicep of choice", {1: "V: Kabel curl"}),
            _sets_row("Bicep of choice", {}),
        ],
        "Program - blok 12 x": [_sets_row("Bicep of choice", {}), _sets_row("Bicep of choice", {})],
    })  # fmt: skip
    plain = lambda _t, _n, _v=None: Scoring(0.6, None)  # noqa: E731
    parsed = parse_all(xlsx, plain)
    by = {(p["block"], p["row"], p["week"]): p["variant"] for p in parsed}
    assert [by[("Program - blok 11 x", 6, w)] for w in (1, 2, 3)] == [
        None,
        "kabel curl",
        "kabel curl",
    ]
    assert [by[("Program - blok 11 x", 7, w)] for w in (1, 2, 3)] == [
        None,
        "kabel curl",
        "kabel curl",
    ]
    assert {by[("Program - blok 12 x", r, w)] for r in (6, 7) for w in (1, 2, 3)} == {None}
    shown = {p["variant_display"] for p in parsed if p["variant"]}
    assert shown == {"Kabel curl"}


# --- the catalogue: aliases and inheritance (15) -------------------------------------------------

PULLUPS = Exercise(id=24, name="Pullups", aliases=(), category="bodyweight", parent_lift=None,
                   muscle_factor=0.6, bodyweight_fraction=0.95, tracks_e1rm=False)  # fmt: skip
TRICEP = Exercise(id=17, name="Tricep of choice", aliases=(), category="isolation",
                  parent_lift=None, muscle_factor=0.3, bodyweight_fraction=None,
                  tracks_e1rm=False)  # fmt: skip
VARIANTS = [
    ExerciseVariant(id=1, exercise_id=24, name="lat pulldown", display_name="Lat Pulldown",
                    no_bodyweight=True),
    ExerciseVariant(id=2, exercise_id=17, name="single arm cable triceps pushdown",
                    display_name="Single arm cable triceps pushdown",
                    aliases=("single armcable triceps pushdown",), per_side=True),
]  # fmt: skip


def test_an_alias_resolves_and_unset_fields_inherit() -> None:
    catalog = Catalog([PULLUPS, TRICEP], VARIANTS)
    found = catalog.find_variant("Tricep of choice", "Single  armcable triceps pushdown")
    assert found is not None and found.id == 2
    assert catalog.scoring("Tricep of choice", 85.0, "single armcable triceps pushdown") == Scoring(
        0.3, None, sides=2
    )
    assert catalog.scoring("Pullups", 85.0, "lat pulldown") == Scoring(0.6, None)  # no bodyweight
    assert catalog.scoring("Pullups", 85.0) == Scoring(0.6, 85.0 * 0.95)
    assert catalog.scoring("Pullups", 85.0, "unknown grip") == Scoring(0.6, 85.0 * 0.95)  # inherits


def test_collect_inserts_unknown_variants_once_and_never_overwrites(db: InMemoryPostgrest) -> None:
    catalog = Catalog([PULLUPS, TRICEP])
    new = catalog.unknown_variants([("Tricep of choice", "db kickback", "DB Kickback"),
                                     ("Abs of choice", "palloff + ghd", "Palloff + GHD"),
                                     ("Pullups", "palloff + ghd", "Palloff + GHD"),
                                     ("Pullups", None, None)])  # fmt: skip
    assert new == [(17, "db kickback", "DB Kickback"), (24, "palloff + ghd", "Palloff + GHD")]
    add_unknown_variants(db, new)
    add_unknown_variants(db, [(17, "db kickback", "Other spelling")])
    stored = {(v.exercise_id, v.name): v for v in all_variants(db)}
    assert len(stored) == 2
    assert stored[(17, "db kickback")].display_name == "DB Kickback"
    assert stored[(24, "palloff + ghd")].suggests is False  # a multi-exercise variant


def test_v_with_the_exercises_own_name_or_alias_names_no_variant() -> None:
    bench = Exercise(id=3, name="Bench press", aliases=("bench", "bænk"), category="main",
                     parent_lift="BENCH", muscle_factor=1.0, bodyweight_fraction=None,
                     tracks_e1rm=True)  # fmt: skip
    catalog = Catalog([bench])
    for written in ("Bench press", " BENCH ", "bænk"):
        assert catalog.find_variant("Bench press", written) is None
        assert catalog.scoring("Bench press", 85.0, written) == Scoring(1.0, None)
    seen = [("Bench press", "bench", "bench"), ("Bench press", "paused bench", "Paused bench")]
    assert catalog.unknown_variants(seen) == [(3, "paused bench", "Paused bench")]


# --- grouping per (exercise, variant) ------------------------------------------------------------


def _set(**kw: object) -> StrengthSet:
    base: dict[str, object] = dict(
        sheet_id="s", block="Program - blok 12", sheet_row=10, week=2, set_no=1, type="SQUAT",
        name="Squat", reps=3.0, logged_kg=140.0, kg=140.0, bodyweight=False, rpe=8.0, score=1.0,
        week_start=date(2026, 10, 5), session=1, prescribed="RPE 8",
    )  # fmt: skip
    return StrengthSet(**(base | kw))  # type: ignore[arg-type]


def test_a_named_variant_of_a_competition_lift_has_no_e1rm() -> None:
    assert e1rm_point(_set(), "lifted") is not None
    assert e1rm_point(_set(variant_id=5), "lifted") is None


def test_switching_variant_restarts_progression() -> None:
    sets = [_set(type="BICEPS", name="Bicep of choice", sheet_row=20, week_start=date(2026, 10, 5),
                 set_no=n, variant_id=1) for n in (1, 2)]  # fmt: skip
    sets += [_set(type="BICEPS", name="Bicep of choice", sheet_row=20,
                  week_start=date(2026, 10, 12), set_no=n, variant_id=2)
             for n in (1, 2)]  # fmt: skip
    logged = [LoggedSet(day=date(2026, 10, 6), session=1, row=20, set_no=n, exercise_id=16,
                        ended_at=f"2026-10-06T10:0{n}:00Z", skipped=False, felt=-1, reps_done=None)
              for n in (1, 2)]  # fmt: skip
    rules = progressions(logged, sets)
    assert (16, 1) in rules and (16, 2) not in rules
