"""public.strength_activities: upsert on id, window-scoped mirror deletions, full read."""

from collections.abc import Collection, Sequence
from datetime import date
from typing import Final, TypedDict

from training_load.db import activities
from training_load.db.client import JsonRow, Postgrest
from training_load.domain.sessions import StrengthActivity
from training_load.narrow import opt_int, opt_str, req_naive_datetime, req_str

TABLE: Final = "strength_activities"


class StrengthActivityRow(TypedDict):
    id: str
    start_date_local: str  # "YYYY-MM-DDTHH:MM:SS", naive
    type: str
    name: str | None
    moving_time_s: int | None
    elapsed_time_s: int | None
    training_load: int | None
    device_name: str | None


COLUMNS: Final = ",".join(StrengthActivityRow.__annotations__)


def to_row(activity: StrengthActivity) -> StrengthActivityRow:
    return StrengthActivityRow(
        id=activity.id,
        start_date_local=activity.start_date_local.isoformat(timespec="seconds"),
        type=activity.type,
        name=activity.name,
        moving_time_s=activity.moving_time_s,
        elapsed_time_s=activity.elapsed_time_s,
        training_load=activity.training_load,
        device_name=activity.device_name,
    )


def from_row(row: JsonRow) -> StrengthActivity:
    """Raises ValueError on a missing or mistyped column."""
    return StrengthActivity(
        id=req_str(row, "id"),
        start_date_local=req_naive_datetime(row, "start_date_local"),
        type=req_str(row, "type"),
        name=opt_str(row, "name"),
        moving_time_s=opt_int(row, "moving_time_s"),
        elapsed_time_s=opt_int(row, "elapsed_time_s"),
        training_load=opt_int(row, "training_load"),
        device_name=opt_str(row, "device_name"),
    )


def upsert_strength_activities(db: Postgrest, items: Sequence[StrengthActivity]) -> None:
    """Upsert on_conflict=id. No-op for an empty sequence."""
    if items:
        db.upsert(TABLE, [to_row(a) for a in items], on_conflict="id")


def ids_between(db: Postgrest, first_day: date, last_day: date) -> set[str]:
    """Ids with first_day <= start_date_local.date() <= last_day."""
    return activities.ids_between(db, first_day, last_day, table=TABLE)


def delete_ids(db: Postgrest, ids: Collection[str]) -> None:
    """DELETE id=in.(...) in chunks, like activities.delete_ids."""
    activities.delete_ids(db, ids, table=TABLE)


def all_strength_activities(db: Postgrest) -> list[StrengthActivity]:
    """Every stored strength activity, paginated, ordered by id."""
    return [from_row(row) for row in db.select(TABLE, columns=COLUMNS, order="id")]
