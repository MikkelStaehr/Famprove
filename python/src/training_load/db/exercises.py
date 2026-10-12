"""public.exercises: read the catalogue; add names it doesn't know (never overwrite a row)."""

from collections.abc import Sequence
from typing import Final

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.exercises import Exercise, unknown_rows
from training_load.narrow import opt_float, opt_str, req_bool, req_float, req_int, req_str

TABLE: Final = "exercises"
COLUMNS: Final = (
    "id,name,aliases,category,parent_lift,muscle_factor,bodyweight_fraction,tracks_e1rm"
)


def _aliases(row: JsonRow) -> tuple[str, ...]:
    value = row.get("aliases")
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(a, str) for a in value):
        raise ValueError("field 'aliases' must be a list of strings")
    return tuple(a for a in value if a.strip())


def from_row(row: JsonRow) -> Exercise:
    """Raises ValueError on a missing or mistyped column (the table's checks hold the bounds)."""
    return Exercise(
        id=req_int(row, "id"),
        name=req_str(row, "name"),
        aliases=_aliases(row),
        category=req_str(row, "category"),
        parent_lift=opt_str(row, "parent_lift"),
        muscle_factor=req_float(row, "muscle_factor"),
        bodyweight_fraction=opt_float(row, "bodyweight_fraction"),
        tracks_e1rm=req_bool(row, "tracks_e1rm"),
    )


def all_exercises(db: Postgrest) -> list[Exercise]:
    return [from_row(row) for row in db.select(TABLE, columns=COLUMNS, order="id")]


def add_unknown(db: Postgrest, names: Sequence[str]) -> None:
    """Insert ``names`` with the unknown-name defaults; a name already stored is left as is
    (ignore-duplicates on name), so the user's corrections are never overwritten."""
    if names:
        db.insert_ignore(TABLE, unknown_rows(names), on_conflict="name")
