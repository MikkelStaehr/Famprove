"""public.strength_sets: replace-per-sheet (delete + insert) by collect-strength, full read for
compute, and compute's write-back of each set's final score and RPE (score_final, rpe_final;
every other column written back as read)."""

from collections.abc import Sequence
from typing import Final, TypedDict

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.strength import StrengthSet
from training_load.narrow import (
    opt_float,
    opt_int,
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
    muscle_factor: float | None  # public.exercises at collect time; null on older rows
    sides: int  # 1 | 2: exercises.per_side at collect time (not null, default 1)
    kg_factor: int  # 1 | 2: exercises.kg_per_dumbbell at collect time (not null, default 1)
    variant_id: int | None  # exercise_variants.id; null = ukendt
    notes: str | None  # the coach's NOTES cell; null = blank
    raw: JsonRow | None  # the week's cells as written
    score_final: float | None  # the score that feeds TSS: collect writes score, compute overwrites
    rpe_final: float | None  # the RPE behind score_final


COLUMNS: Final = ",".join(
    c for c in StrengthSetRow.__annotations__ if c not in ("score_final", "rpe_final")
)  # read back: compute derives the final values itself


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
        muscle_factor=s.muscle_factor,
        sides=s.sides,
        kg_factor=s.kg_factor,
        variant_id=s.variant_id,
        notes=s.notes,
        raw=dict(s.raw) if s.raw is not None else None,
        score_final=s.score,
        rpe_final=s.rpe,
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
        muscle_factor=opt_float(row, "muscle_factor"),
        sides=req_int(row, "sides"),
        kg_factor=req_int(row, "kg_factor"),
        variant_id=opt_int(row, "variant_id"),
        notes=opt_str(row, "notes"),
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


KEY: Final = "sheet_id,block,sheet_row,week,set_no"  # the primary key


def sync_final_scores(
    db: Postgrest, stored: Sequence[StrengthSet], final: Sequence[StrengthSet]
) -> int:
    """Writes compute's final score and RPE per set (score_final, rpe_final), so the week view
    shows what feeds daily_load. ``stored``: the sets as read; ``final``: the same sets after
    compute's rescoring, in the same order. Every other column is written back as read, so the
    row keeps mirroring the sheet. One upsert; returns how many sets differ from the parser's."""
    if len(stored) != len(final):
        raise ValueError("stored and final sets must pair up")
    rows: list[StrengthSetRow] = []
    changed = 0
    for s, f in zip(stored, final, strict=True):
        if (s.sheet_id, s.block, s.sheet_row, s.week, s.set_no) != (
            f.sheet_id,
            f.block,
            f.sheet_row,
            f.week,
            f.set_no,
        ):
            raise ValueError("stored and final sets must pair up by key")
        row = to_row(s)
        row["score_final"] = f.score
        row["rpe_final"] = f.rpe
        changed += f.score != s.score
        rows.append(row)
    if rows:
        db.upsert(TABLE, rows, on_conflict=KEY)
    return changed
