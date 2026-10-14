"""public.exercise_variants (user, 2026-10-14): variants of an exercise from "V:" lines in the
sheet. Hand-edited like public.exercises: code reads them and inserts unknown ones, never
updates them."""

from collections.abc import Sequence
from typing import Final

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.exercises import ExerciseVariant
from training_load.narrow import opt_float, req_bool, req_int, req_str

TABLE: Final = "exercise_variants"
COLUMNS: Final = (
    "id,exercise_id,name,display_name,aliases,muscle_factor,bodyweight_fraction,no_bodyweight,"
    "per_side,kg_per_dumbbell,suggests"
)


def _opt_bool(row: JsonRow, column: str) -> bool | None:
    """A nullable boolean (null = inherit from the exercise); anything else is an error."""
    value = row.get(column)
    if value is not None and not isinstance(value, bool):
        raise ValueError(f"field {column!r} must be a boolean or null")
    return value


def _aliases(row: JsonRow) -> tuple[str, ...]:
    value = row.get("aliases")
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(a, str) for a in value):
        raise ValueError("field 'aliases' must be a list of strings")
    return tuple(a for a in value if a.strip())


def from_row(row: JsonRow) -> ExerciseVariant:
    """Raises ValueError on a missing or mistyped column (the table's checks hold the bounds)."""
    return ExerciseVariant(
        id=req_int(row, "id"),
        exercise_id=req_int(row, "exercise_id"),
        name=req_str(row, "name"),
        display_name=req_str(row, "display_name"),
        aliases=_aliases(row),
        muscle_factor=opt_float(row, "muscle_factor"),
        bodyweight_fraction=opt_float(row, "bodyweight_fraction"),
        no_bodyweight=req_bool(row, "no_bodyweight"),
        per_side=_opt_bool(row, "per_side"),
        kg_per_dumbbell=_opt_bool(row, "kg_per_dumbbell"),
        suggests=req_bool(row, "suggests"),
    )


def all_variants(db: Postgrest) -> list[ExerciseVariant]:
    return [from_row(row) for row in db.select(TABLE, columns=COLUMNS, order="id")]


def add_unknown_variants(db: Postgrest, variants: Sequence[tuple[int, str, str]]) -> None:
    """Insert (exercise id, normalised name, display name) with every value inheriting; a variant
    already stored is left as is (ignore-duplicates on exercise_id + name), so the user's values
    are never overwritten. A multi-exercise variant ("palloff + ghd") gets suggests = false."""
    if variants:
        rows = [
            {"exercise_id": eid, "name": name, "display_name": shown, "suggests": "+" not in name}
            for eid, name, shown in variants
        ]
        db.insert_ignore(TABLE, rows, on_conflict="exercise_id,name")
