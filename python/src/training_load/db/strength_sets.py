"""public.strength_sets: replace-per-sheet (delete + insert), full read for compute."""

from collections.abc import Sequence
from typing import Final, TypedDict

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.strength import StrengthSet
from training_load.narrow import (
    opt_float,
    opt_object,
    opt_str,
    req_bool,
    req_date,
    req_float,
    req_int,
    req_str,
)

TABLE: Final = "strength_sets"
ORDER: Final = "sheet_id,block,sheet_row,week,set_no"  # the primary key: stable pagination


class EmptyReplaceError(RuntimeError):
    """A parse produced 0 sets: refusing to wipe the sheet's stored rows."""


class StrengthSetRow(TypedDict):
    sheet_id: str
    block: str
    sheet_row: int
    week: int
    set_no: int
    week_start: str  # ISO date, a Monday
    session: int
    type: str
    name: str
    reps: float
    logged_kg: float | None
    kg: float
    bodyweight: bool
    rpe: float | None
    score: float
    prescribed: str | None
    sets_text: str | None
    reps_text: str | None
    e1rm: float | None
    logged_rpe: float | None
    raw: JsonRow | None  # the week's cells as written


COLUMNS: Final = ",".join(StrengthSetRow.__annotations__)


def to_row(s: StrengthSet) -> StrengthSetRow:
    return StrengthSetRow(
        sheet_id=s.sheet_id,
        block=s.block,
        sheet_row=s.sheet_row,
        week=s.week,
        set_no=s.set_no,
        week_start=s.week_start.isoformat(),
        session=s.session,
        type=s.type,
        name=s.name,
        reps=s.reps,
        logged_kg=s.logged_kg,
        kg=s.kg,
        bodyweight=s.bodyweight,
        rpe=s.rpe,
        score=s.score,
        prescribed=s.prescribed,
        sets_text=s.sets_text,
        reps_text=s.reps_text,
        e1rm=s.e1rm,
        logged_rpe=s.logged_rpe,
        raw=dict(s.raw) if s.raw is not None else None,
    )


def from_row(row: JsonRow) -> StrengthSet:
    """Raises ValueError on a missing or mistyped column."""
    return StrengthSet(
        sheet_id=req_str(row, "sheet_id"),
        block=req_str(row, "block"),
        sheet_row=req_int(row, "sheet_row"),
        week=req_int(row, "week"),
        set_no=req_int(row, "set_no"),
        week_start=req_date(row, "week_start"),
        session=req_int(row, "session"),
        type=req_str(row, "type"),
        name=req_str(row, "name"),
        reps=req_float(row, "reps"),
        logged_kg=opt_float(row, "logged_kg"),
        kg=req_float(row, "kg"),
        bodyweight=req_bool(row, "bodyweight"),
        rpe=opt_float(row, "rpe"),
        score=req_float(row, "score"),
        prescribed=opt_str(row, "prescribed"),
        sets_text=opt_str(row, "sets_text"),
        reps_text=opt_str(row, "reps_text"),
        e1rm=opt_float(row, "e1rm"),
        logged_rpe=opt_float(row, "logged_rpe"),
        raw=opt_object(row, "raw"),
    )


def replace_for_sheet(db: Postgrest, sheet_id: str, sets: Sequence[StrengthSet]) -> None:
    """Delete sheet_id=eq.<sheet_id>, then insert ``sets``.

    Guard first: raise EmptyReplaceError if ``sets`` is empty; ValueError if any set has a
    different sheet_id. Not atomic (two HTTP calls): the CI workflow must not run two jobs
    concurrently, and the primary key turns an overlap into a loud 409, not duplicates.
    """
    if not sets:
        raise EmptyReplaceError(
            "the workbook parsed to 0 sets; keeping the stored rows (template changed?)"
        )
    if any(s.sheet_id != sheet_id for s in sets):
        raise ValueError("every set must belong to the sheet being replaced")
    db.delete(TABLE, [("sheet_id", f"eq.{sheet_id}")])
    db.insert(TABLE, [to_row(s) for s in sets])


def all_sets(db: Postgrest) -> list[StrengthSet]:
    """Every stored set, all sheets, paginated with ORDER."""
    return [from_row(row) for row in db.select(TABLE, columns=COLUMNS, order=ORDER)]
