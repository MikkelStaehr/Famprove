"""public.daily_projection: upsert on date + delete rows outside the projected range."""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.projection import Basis, ProjectedDay

TABLE: Final = "daily_projection"


class DailyProjectionRow(TypedDict):
    date: str  # ISO date
    cycling_tss: float
    strength_tss: float
    ctl: float
    atl: float
    tsb: float
    basis: Basis
    computed_at: str  # ISO timestamptz (UTC), the same on every row of one compute run


def to_row(day: ProjectedDay, computed_at: datetime) -> DailyProjectionRow:
    return DailyProjectionRow(
        date=day.date.isoformat(),
        cycling_tss=day.cycling_tss,
        strength_tss=day.strength_tss,
        ctl=day.ctl,
        atl=day.atl,
        tsb=day.tsb,
        basis=day.basis,
        computed_at=computed_at.isoformat(),
    )


def sync_projection(db: Postgrest, days: Sequence[ProjectedDay], *, computed_at: datetime) -> None:
    """Upsert ``days`` on date, then delete every row outside first..last (yesterday's run
    leaves a day that is now history; it must not be drawn as prognose)."""
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if not days:
        raise ValueError("a projection has at least one day")
    first: date = days[0].date
    last: date = days[-1].date
    db.upsert(TABLE, [to_row(d, computed_at) for d in days], on_conflict="date")
    db.delete(TABLE, [("or", f"(date.lt.{first.isoformat()},date.gt.{last.isoformat()})")])
