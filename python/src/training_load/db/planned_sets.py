"""public.planned_sets: suggested kg per set of the current ISO week and later, rebuilt by compute
(upsert with this run's computed_at, then delete older rows). The web only reads it."""

from collections.abc import Sequence
from datetime import datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.planned_sets import Basis, PlannedSet

TABLE: Final = "planned_sets"
KEY: Final = "sheet_id,block,sheet_row,week,set_no"  # the strength_sets key


class PlannedSetRow(TypedDict):
    sheet_id: str
    block: str
    sheet_row: int
    week: int
    set_no: int
    week_start: str  # ISO Monday
    session: int
    exercise_id: int | None
    e1rm_lift: str | None
    e1rm_kg: float | None
    rpe: float | None
    reps: float
    pct: float | None
    suggested_kg: float | None  # null: no suggestion (basis says why), never 0
    basis: Basis
    uncapped_kg: float | None  # the suggestion before the weekly cap; null: the cap didn't apply
    computed_at: str  # ISO timestamptz (UTC), the same on every row of one compute run


def to_row(p: PlannedSet, computed_at: datetime) -> PlannedSetRow:
    return PlannedSetRow(
        sheet_id=p.sheet_id,
        block=p.block,
        sheet_row=p.sheet_row,
        week=p.week,
        set_no=p.set_no,
        week_start=p.week_start.isoformat(),
        session=p.session,
        exercise_id=p.exercise_id,
        e1rm_lift=p.e1rm_lift,
        e1rm_kg=p.e1rm_kg,
        rpe=p.rpe,
        reps=p.reps,
        pct=p.pct,
        suggested_kg=p.suggested_kg,
        basis=p.basis,
        uncapped_kg=p.uncapped_kg,
        computed_at=computed_at.isoformat(),
    )


def sync_planned_sets(db: Postgrest, rows: Sequence[PlannedSet], *, computed_at: datetime) -> None:
    """Upsert ``rows`` with this run's computed_at, then delete every older row (sets of weeks
    that have passed, or that left the sheet)."""
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if rows:
        db.upsert(TABLE, [to_row(p, computed_at) for p in rows], on_conflict=KEY)
    db.delete(TABLE, [("computed_at", f"lt.{computed_at.isoformat()}")])
