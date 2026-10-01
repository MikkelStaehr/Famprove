"""public.forecast_log: every run's forecast next to the naive baseline, kept for error analysis.

Append-only per made_on: a run upserts its own (made_on, target_date, method) rows, so the
last run of a day wins, and never touches earlier days. Never rebuilt or pruned.
"""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.db.daily_projection import _high, _low
from training_load.domain.projection import ProjectedDay

TABLE: Final = "forecast_log"

# params is stored as jsonb and only read as JSON.
type Params = dict[str, object]


class ForecastLogRow(TypedDict):
    made_on: str
    target_date: str
    method: str  # "model" or "naive"
    cycling_tss: float
    strength_tss: float
    ctl: float
    atl: float
    tsb: float
    ctl_low: float | None
    ctl_high: float | None
    atl_low: float | None
    atl_high: float | None
    tsb_low: float | None
    tsb_high: float | None
    strength_method: str | None
    params: Params
    computed_at: str


def to_row(
    day: ProjectedDay, *, made_on: date, method: str, params: Params, computed_at: datetime
) -> ForecastLogRow:
    return ForecastLogRow(
        made_on=made_on.isoformat(),
        target_date=day.date.isoformat(),
        method=method,
        cycling_tss=day.cycling_tss,
        strength_tss=day.strength_tss,
        ctl=day.ctl,
        atl=day.atl,
        tsb=day.tsb,
        ctl_low=_low(day.ctl_band),
        ctl_high=_high(day.ctl_band),
        atl_low=_low(day.atl_band),
        atl_high=_high(day.atl_band),
        tsb_low=_low(day.tsb_band),
        tsb_high=_high(day.tsb_band),
        strength_method=day.strength_method if method == "model" else None,
        params=params,
        computed_at=computed_at.isoformat(),
    )


def log_forecast(
    db: Postgrest,
    *,
    made_on: date,
    model: Sequence[ProjectedDay],
    naive: Sequence[ProjectedDay],
    params: Params,
    computed_at: datetime,
) -> int:
    """Upsert this run's model and naive rows on (made_on, target_date, method). Returns rows."""
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    rows = [
        to_row(d, made_on=made_on, method=method, params=params, computed_at=computed_at)
        for method, days in (("model", model), ("naive", naive))
        for d in days
    ]
    if rows:
        db.upsert(TABLE, rows, on_conflict="made_on,target_date,method")
    return len(rows)
