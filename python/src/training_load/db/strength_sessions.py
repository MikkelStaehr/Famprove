"""public.strength_sessions: upsert on (week_start, session) + prune keys no longer derived."""

from collections.abc import Sequence
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.sessions import StrengthSession
from training_load.narrow import req_int, req_str

TABLE: Final = "strength_sessions"


class StrengthSessionRow(TypedDict):
    week_start: str  # ISO date, a Monday
    session: int
    sheet_id: str | None
    block: str | None
    week: int | None
    activity_id: str | None
    date: str | None  # ISO date; None until done
    activity_name: str | None
    moving_time_s: int | None
    tss: float


def to_row(s: StrengthSession) -> StrengthSessionRow:
    return StrengthSessionRow(
        week_start=s.week_start.isoformat(),
        session=s.session,
        sheet_id=s.sheet_id,
        block=s.block,
        week=s.week,
        activity_id=s.activity_id,
        date=s.date.isoformat() if s.date else None,
        activity_name=s.activity_name,
        moving_time_s=s.moving_time_s,
        tss=s.tss,
    )


def stored_keys(db: Postgrest) -> set[tuple[str, int]]:
    """Every stored (week_start, session), paginated, ordered by the primary key."""
    rows = db.select(TABLE, columns="week_start,session", order="week_start,session")
    return {(req_str(row, "week_start"), req_int(row, "session")) for row in rows}


def sync_strength_sessions(db: Postgrest, sessions: Sequence[StrengthSession]) -> None:
    """Upsert ``sessions`` (on_conflict=week_start,session), then delete stored keys not in it.

    Every row carries every column, so a session that lost its activity is written back with
    nulls (no date) rather than keeping a stale one.
    """
    if sessions:
        db.upsert(TABLE, [to_row(s) for s in sessions], on_conflict="week_start,session")
    stale = stored_keys(db) - {(s.week_start.isoformat(), s.session) for s in sessions}
    for week_start, session in sorted(stale):
        db.delete(TABLE, [("week_start", f"eq.{week_start}"), ("session", f"eq.{session}")])
