"""public.strength_weeks (rebuilt by compute) and public.strength_set_kg (persistent kg history,
updated incrementally and never rebuilt or pruned)."""

from collections.abc import Sequence
from datetime import datetime
from typing import Final, Literal, TypedDict

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.kg_history import KgKey, KgState
from training_load.domain.strength_analysis import Phase, RpeSource, StrengthWeek
from training_load.narrow import opt_float, opt_str, req_date, req_int, req_str

WEEKS_TABLE: Final = "strength_weeks"
KG_TABLE: Final = "strength_set_kg"


class StrengthWeekRow(TypedDict):
    week_start: str  # ISO Monday
    lift: str
    block: str | None
    block_no: int | None
    phase: Phase | None
    status: Literal["lifted", "pre_log"] | None
    sets_lifted: int
    tonnage_kg: float
    e1rm_kg: float | None
    e1rm_load_kg: float | None
    e1rm_reps: float | None
    e1rm_rpe: float | None
    e1rm_rpe_source: RpeSource | None
    is_block_best: bool
    computed_at: str  # ISO timestamptz (UTC), the same on every row of one compute run


class KgStateRow(TypedDict):
    sheet_id: str
    block: str
    week: int
    session: int
    name: str
    prescribed: str  # "" when the load cell is blank
    occurrence: int
    set_no: int
    sheet_row: int
    type: str
    reps_text: str | None
    week_start: str
    planned_first_kg: float | None
    planned_first_at: str | None
    planned_last_kg: float | None
    planned_last_at: str | None
    lifted_kg: float | None
    lifted_first_at: str | None
    lifted_changed_at: str | None
    first_seen_at: str
    gone_at: str | None


KG_COLUMNS: Final = ",".join(KgStateRow.__annotations__)
KG_ORDER: Final = "sheet_id,block,week,session,name,prescribed,occurrence,set_no"  # the PK


def week_row(w: StrengthWeek, computed_at: datetime) -> StrengthWeekRow:
    return StrengthWeekRow(
        week_start=w.week_start.isoformat(),
        lift=w.lift,
        block=w.block,
        block_no=w.block_no,
        phase=w.phase,
        status=w.status,
        sets_lifted=w.sets_lifted,
        tonnage_kg=w.tonnage_kg,
        e1rm_kg=w.e1rm_kg,
        e1rm_load_kg=w.e1rm_load_kg,
        e1rm_reps=w.e1rm_reps,
        e1rm_rpe=w.e1rm_rpe,
        e1rm_rpe_source=w.e1rm_rpe_source,
        is_block_best=w.is_block_best,
        computed_at=computed_at.isoformat(),
    )


def sync_strength_weeks(
    db: Postgrest, weeks: Sequence[StrengthWeek], *, computed_at: datetime
) -> None:
    """Upsert every week with this run's computed_at, then delete older rows."""
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if weeks:
        db.upsert(
            WEEKS_TABLE, [week_row(w, computed_at) for w in weeks], on_conflict="week_start,lift"
        )
    db.delete(WEEKS_TABLE, [("computed_at", f"lt.{computed_at.isoformat()}")])


def _at(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def kg_row(k: KgState) -> KgStateRow:
    sheet_id, block, week, session, name, prescribed, occurrence, set_no = k.key
    return KgStateRow(
        sheet_id=sheet_id,
        block=block,
        week=week,
        session=session,
        name=name,
        prescribed=prescribed,
        occurrence=occurrence,
        set_no=set_no,
        sheet_row=k.sheet_row,
        type=k.type,
        reps_text=k.reps_text,
        week_start=k.week_start.isoformat(),
        planned_first_kg=k.planned_first_kg,
        planned_first_at=_at(k.planned_first_at),
        planned_last_kg=k.planned_last_kg,
        planned_last_at=_at(k.planned_last_at),
        lifted_kg=k.lifted_kg,
        lifted_first_at=_at(k.lifted_first_at),
        lifted_changed_at=_at(k.lifted_changed_at),
        first_seen_at=k.first_seen_at.isoformat(),
        gone_at=_at(k.gone_at),
    )


def _opt_at(row: JsonRow, column: str) -> datetime | None:
    value = opt_str(row, column)
    return datetime.fromisoformat(value) if value is not None else None


def kg_from_row(row: JsonRow) -> KgState:
    """Raises ValueError on a missing or mistyped column."""
    key: KgKey = (
        req_str(row, "sheet_id"),
        req_str(row, "block"),
        req_int(row, "week"),
        req_int(row, "session"),
        req_str(row, "name"),
        req_str(row, "prescribed"),
        req_int(row, "occurrence"),
        req_int(row, "set_no"),
    )
    return KgState(
        key=key,
        sheet_row=req_int(row, "sheet_row"),
        type=req_str(row, "type"),
        reps_text=opt_str(row, "reps_text"),
        week_start=req_date(row, "week_start"),
        planned_first_kg=opt_float(row, "planned_first_kg"),
        planned_first_at=_opt_at(row, "planned_first_at"),
        planned_last_kg=opt_float(row, "planned_last_kg"),
        planned_last_at=_opt_at(row, "planned_last_at"),
        lifted_kg=opt_float(row, "lifted_kg"),
        lifted_first_at=_opt_at(row, "lifted_first_at"),
        lifted_changed_at=_opt_at(row, "lifted_changed_at"),
        first_seen_at=datetime.fromisoformat(req_str(row, "first_seen_at")),
        gone_at=_opt_at(row, "gone_at"),
    )


def all_kg_states(db: Postgrest) -> dict[KgKey, KgState]:
    """Every stored state, paginated, keyed by the set's primary key."""
    states = (kg_from_row(r) for r in db.select(KG_TABLE, columns=KG_COLUMNS, order=KG_ORDER))
    return {s.key: s for s in states}


def upsert_kg_states(db: Postgrest, states: Sequence[KgState]) -> None:
    """Upsert the changed states only (rows are never deleted: history). No-op when empty."""
    if states:
        db.upsert(KG_TABLE, [kg_row(s) for s in states], on_conflict=KG_ORDER)
