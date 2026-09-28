"""public.daily_load: upsert on date + delete rows outside the recomputed range."""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.daily import DailyLoad
from training_load.domain.dates import date_range

TABLE: Final = "daily_load"


class DailyLoadRow(TypedDict):
    date: str  # ISO date
    cycling_tss: float
    strength_tss: float
    total_tss: float
    ctl: float
    atl: float
    tsb: float
    ctl_ramp_7d: float | None
    form_zone: str
    computed_at: str  # ISO timestamptz (UTC), identical on every row of one compute run


def to_row(day: DailyLoad, computed_at: datetime) -> DailyLoadRow:
    return DailyLoadRow(
        date=day.date.isoformat(),
        cycling_tss=day.cycling_tss,
        strength_tss=day.strength_tss,
        total_tss=day.total_tss,
        ctl=day.ctl,
        atl=day.atl,
        tsb=day.tsb,
        ctl_ramp_7d=day.ctl_ramp_7d,
        form_zone=day.form_zone.value,
        computed_at=computed_at.isoformat(),
    )


def sync_daily_load(
    db: Postgrest, days: Sequence[DailyLoad], *, start: date, end: date, computed_at: datetime
) -> None:
    """Upsert ``days`` on_conflict=date, then delete ``or=(date.lt.<start>,date.gt.<end>)``.

    Every row carries the same ``computed_at`` (the run's start, tz-aware). ValueError if
    ``computed_at`` is naive or ``days`` is not exactly one row per date in [start, end].
    """
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if [d.date for d in days] != date_range(start, end):
        raise ValueError(f"daily_load must hold exactly one row per day {start}..{end}")
    db.upsert(TABLE, [to_row(d, computed_at) for d in days], on_conflict="date")
    db.delete(TABLE, [("or", f"(date.lt.{start.isoformat()},date.gt.{end.isoformat()})")])
