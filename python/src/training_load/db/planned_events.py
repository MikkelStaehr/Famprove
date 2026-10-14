"""public.planned_events: the intervals.icu calendar, mirrored raw by collect-intervals
(upsert on the event id, deletions mirrored inside the fetched window); compute reads it."""

from collections.abc import Collection, Sequence
from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.calendar import PlannedEvent
from training_load.narrow import opt_float, opt_str, req_date, req_int, req_str

TABLE: Final = "planned_events"
DELETE_CHUNK: Final = 100


class PlannedEventRow(TypedDict):
    id: int
    date: str  # ISO date (local)
    category: str
    type: str | None
    name: str | None
    load: float | None  # null = missing, never 0
    raw: object  # the event object as delivered (jsonb)
    fetched_at: str  # ISO timestamptz (UTC), one value per run


COLUMNS: Final = "id,date,category,type,name,load"  # raw stays in the table; compute needs none


def to_row(event: PlannedEvent, fetched_at: datetime) -> PlannedEventRow:
    if fetched_at.tzinfo is None:
        raise ValueError("fetched_at must be timezone-aware")
    return PlannedEventRow(
        id=event.id,
        date=event.date.isoformat(),
        category=event.category,
        type=event.type,
        name=event.name,
        load=event.load,
        raw=dict(event.raw),
        fetched_at=fetched_at.isoformat(),
    )


def from_row(row: JsonRow) -> PlannedEvent:
    return PlannedEvent(
        id=req_int(row, "id"),
        date=req_date(row, "date"),
        category=req_str(row, "category"),
        type=opt_str(row, "type"),
        name=opt_str(row, "name"),
        load=opt_float(row, "load"),
        raw={},
    )


def upsert_events(db: Postgrest, events: Sequence[PlannedEvent], *, fetched_at: datetime) -> None:
    if events:
        db.upsert(TABLE, [to_row(e, fetched_at) for e in events], on_conflict="id")


def ids_between(db: Postgrest, first_day: date, last_day: date) -> set[int]:
    """Ids of the stored events with first_day <= date <= last_day."""
    rows = db.select(
        TABLE,
        columns="id",
        order="id",
        filters=[("date", f"gte.{first_day.isoformat()}"), ("date", f"lt.{_next(last_day)}")],
    )
    return {req_int(row, "id") for row in rows}


def delete_ids(db: Postgrest, ids: Collection[int]) -> None:
    """DELETE id=in.(...) in chunks. No-op when empty."""
    ordered = sorted(ids)
    for start in range(0, len(ordered), DELETE_CHUNK):
        chunk = ordered[start : start + DELETE_CHUNK]
        db.delete(TABLE, [("id", f"in.({','.join(str(i) for i in chunk)})")])


def events_between(db: Postgrest, first_day: date, last_day: date) -> list[PlannedEvent]:
    """The stored events with first_day <= date <= last_day, ordered by date and id."""
    rows = db.select(
        TABLE,
        columns=COLUMNS,
        order="date,id",
        filters=[("date", f"gte.{first_day.isoformat()}"), ("date", f"lt.{_next(last_day)}")],
    )
    return [from_row(row) for row in rows]


def _next(day: date) -> str:
    return date.fromordinal(day.toordinal() + 1).isoformat()
