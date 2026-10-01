"""public.activities: upsert on id, window-scoped mirror deletions, full read for compute."""

import re
from collections.abc import Collection, Sequence
from datetime import date, timedelta
from typing import Final, TypedDict

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.cycling import CyclingActivity
from training_load.narrow import (
    opt_float,
    opt_int,
    opt_object,
    opt_str,
    req_naive_datetime,
    req_str,
)

TABLE: Final = "activities"


class ActivityRow(TypedDict):
    id: str
    start_date_local: str  # "YYYY-MM-DDTHH:MM:SS", naive
    type: str
    name: str | None
    training_load: int | None
    weighted_avg_watts: int | None
    intensity_pct: float | None
    ftp: int | None
    moving_time_s: int | None
    elapsed_time_s: int | None
    power_load: int | None
    hr_load: int | None
    device_name: str | None
    raw: JsonRow | None  # the intervals.icu object as delivered


COLUMNS: Final = ",".join(ActivityRow.__annotations__)
DELETE_CHUNK: Final = 100
_SAFE_ID: Final = re.compile(r"^[A-Za-z0-9_-]+$")


def to_row(activity: CyclingActivity) -> ActivityRow:
    return ActivityRow(
        id=activity.id,
        start_date_local=activity.start_date_local.isoformat(timespec="seconds"),
        type=activity.type,
        name=activity.name,
        training_load=activity.training_load,
        weighted_avg_watts=activity.weighted_avg_watts,
        intensity_pct=activity.intensity_pct,
        ftp=activity.ftp,
        moving_time_s=activity.moving_time_s,
        elapsed_time_s=activity.elapsed_time_s,
        power_load=activity.power_load,
        hr_load=activity.hr_load,
        device_name=activity.device_name,
        raw=dict(activity.raw) if activity.raw is not None else None,
    )


def from_row(row: JsonRow) -> CyclingActivity:
    """Raises ValueError on a missing or mistyped column."""
    return CyclingActivity(
        id=req_str(row, "id"),
        start_date_local=req_naive_datetime(row, "start_date_local"),
        type=req_str(row, "type"),
        name=opt_str(row, "name"),
        training_load=opt_int(row, "training_load"),
        weighted_avg_watts=opt_int(row, "weighted_avg_watts"),
        intensity_pct=opt_float(row, "intensity_pct"),
        ftp=opt_int(row, "ftp"),
        moving_time_s=opt_int(row, "moving_time_s"),
        elapsed_time_s=opt_int(row, "elapsed_time_s"),
        power_load=opt_int(row, "power_load"),
        hr_load=opt_int(row, "hr_load"),
        device_name=opt_str(row, "device_name"),
        raw=opt_object(row, "raw"),
    )


def upsert_activities(db: Postgrest, activities: Sequence[CyclingActivity]) -> None:
    """Upsert on_conflict=id. No-op for an empty sequence."""
    if activities:
        db.upsert(TABLE, [to_row(a) for a in activities], on_conflict="id")


def ids_between(db: Postgrest, first_day: date, last_day: date, *, table: str = TABLE) -> set[str]:
    """Ids with first_day <= start_date_local.date() <= last_day, in ``table`` (activities or
    strength_activities: same id and start_date_local columns).

    Filters: start_date_local=gte.{first_day}T00:00:00 and lt.{last_day + 1}T00:00:00.
    """
    rows = db.select(
        table,
        columns="id",
        order="id",
        filters=[
            ("start_date_local", f"gte.{first_day.isoformat()}T00:00:00"),
            ("start_date_local", f"lt.{(last_day + timedelta(days=1)).isoformat()}T00:00:00"),
        ],
    )
    return {req_str(row, "id") for row in rows}


def delete_ids(db: Postgrest, ids: Collection[str], *, table: str = TABLE) -> None:
    """DELETE id=in.(...) in chunks (ids are URL-safe, e.g. i55751783). No-op when empty."""
    ordered = sorted(ids)
    for bad in (i for i in ordered if not _SAFE_ID.match(i)):
        raise ValueError(f"refusing to delete by unexpected activity id {bad!r}")
    for start in range(0, len(ordered), DELETE_CHUNK):
        chunk = ordered[start : start + DELETE_CHUNK]
        db.delete(table, [("id", f"in.({','.join(chunk)})")])


def all_activities(db: Postgrest) -> list[CyclingActivity]:
    """Every stored activity, paginated, ordered by id."""
    return [from_row(row) for row in db.select(TABLE, columns=COLUMNS, order="id")]
