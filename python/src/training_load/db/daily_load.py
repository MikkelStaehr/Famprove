"""public.daily_load: upsert on date + delete rows outside the recomputed range."""

from collections.abc import Sequence
from datetime import date
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


def to_row(day: DailyLoad) -> DailyLoadRow:
    return DailyLoadRow(
        date=day.date.isoformat(),
        cycling_tss=day.cycling_tss,
        strength_tss=day.strength_tss,
        total_tss=day.total_tss,
        ctl=day.ctl,
        atl=day.atl,
        tsb=day.tsb,
    )


def sync_daily_load(db: Postgrest, days: Sequence[DailyLoad], *, start: date, end: date) -> None:
    """Upsert ``days`` on_conflict=date, then delete ``or=(date.lt.<start>,date.gt.<end>)``.

    ValueError if ``days`` is not exactly one row per date in [start, end].
    """
    if [d.date for d in days] != date_range(start, end):
        raise ValueError(f"daily_load must hold exactly one row per day {start}..{end}")
    db.upsert(TABLE, [to_row(d) for d in days], on_conflict="date")
    db.delete(TABLE, [("or", f"(date.lt.{start.isoformat()},date.gt.{end.isoformat()})")])
