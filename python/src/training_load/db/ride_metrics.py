"""public.ride_metrics and public.cycling_weeks: rebuilt by compute (upsert, then delete the
rows an earlier run left behind)."""

from collections.abc import Sequence
from datetime import datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.ride_analysis import CyclingWeek, Exclusion, RideMetrics

TABLE: Final = "ride_metrics"
WEEKS_TABLE: Final = "cycling_weeks"


class RideMetricsRow(TypedDict):
    activity_id: str
    date: str  # ISO date (local)
    type: str
    moving_s: int | None
    distance_m: float | None
    load: int | None
    np_w: int | None
    avg_hr: int | None
    device_watts: bool | None
    ftp_w: int | None
    if_set: float | None
    rolling_ftp_w: int | None
    if_eftp: float | None
    ef: float | None
    exclusion: Exclusion | None
    eftp_ok: bool
    eftp_gap_before: bool
    ef_ok: bool
    ef_trend: float | None
    ef_gap_before: bool
    eftp_year_ago_date: str | None  # ISO date of the comparison point
    eftp_year_ago_w: int | None
    eftp_delta_w: int | None  # rolling_ftp_w - eftp_year_ago_w
    computed_at: str  # ISO timestamptz (UTC), the same on every row of one compute run


class CyclingWeekRow(TypedDict):
    week_start: str  # ISO Monday
    rides: int
    moving_s: int
    load: int
    excluded: int
    computed_at: str


def to_row(m: RideMetrics, computed_at: datetime) -> RideMetricsRow:
    f, year_ago = m.facts, m.eftp_year_ago
    return RideMetricsRow(
        activity_id=f.activity_id,
        date=f.day.isoformat(),
        type=f.type,
        moving_s=f.moving_s,
        distance_m=f.distance_m,
        load=f.load,
        np_w=f.np_w,
        avg_hr=f.avg_hr,
        device_watts=f.device_watts,
        ftp_w=f.ftp_w,
        if_set=f.if_set,
        rolling_ftp_w=f.rolling_ftp_w,
        if_eftp=m.if_eftp,
        ef=m.ef,
        exclusion=m.exclusion,
        eftp_ok=m.eftp_ok,
        eftp_gap_before=m.eftp_gap_before,
        ef_ok=m.ef_ok,
        ef_trend=m.ef_trend,
        ef_gap_before=m.ef_gap_before,
        eftp_year_ago_date=year_ago[0].isoformat() if year_ago else None,
        eftp_year_ago_w=year_ago[1] if year_ago else None,
        eftp_delta_w=(
            f.rolling_ftp_w - year_ago[1] if year_ago and f.rolling_ftp_w is not None else None
        ),
        computed_at=computed_at.isoformat(),
    )


def week_row(w: CyclingWeek, computed_at: datetime) -> CyclingWeekRow:
    return CyclingWeekRow(
        week_start=w.week_start.isoformat(),
        rides=w.rides,
        moving_s=w.moving_s,
        load=w.load,
        excluded=w.excluded,
        computed_at=computed_at.isoformat(),
    )


def _rebuild(
    db: Postgrest,
    table: str,
    rows: Sequence[RideMetricsRow] | Sequence[CyclingWeekRow],
    *,
    on_conflict: str,
    computed_at: datetime,
) -> None:
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if rows:
        db.upsert(table, rows, on_conflict=on_conflict)
    db.delete(table, [("computed_at", f"lt.{computed_at.isoformat()}")])


def sync_ride_metrics(
    db: Postgrest,
    rides: Sequence[RideMetrics],
    weeks: Sequence[CyclingWeek],
    *,
    computed_at: datetime,
) -> None:
    """Upsert every ride and week with this run's computed_at, then delete older rows (rides
    deleted in intervals.icu, weeks before the window)."""
    _rebuild(
        db,
        TABLE,
        [to_row(m, computed_at) for m in rides],
        on_conflict="activity_id",
        computed_at=computed_at,
    )
    _rebuild(
        db,
        WEEKS_TABLE,
        [week_row(w, computed_at) for w in weeks],
        on_conflict="week_start",
        computed_at=computed_at,
    )
