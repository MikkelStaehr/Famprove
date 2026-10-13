"""public.app_notices: one current notice per kind (e.g. ftp_mismatch), shown on /load.
Written by the daily job: upserted while the condition holds, deleted when it no longer does."""

from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest

TABLE: Final = "app_notices"


class AppNoticeRow(TypedDict):
    kind: str
    date: str  # ISO date the condition was last seen (the run day)
    message: str  # Danish, shown as is
    updated_at: str  # ISO timestamptz of the write


def set_notice(
    db: Postgrest, kind: str, message: str | None, *, today: date, now: datetime
) -> None:
    """Upsert the notice of ``kind`` while ``message`` is set; delete it when it is None."""
    if message is None:
        db.delete(TABLE, [("kind", f"eq.{kind}")])
        return
    row = AppNoticeRow(
        kind=kind, date=today.isoformat(), message=message, updated_at=now.isoformat()
    )
    db.upsert(TABLE, [row], on_conflict="kind")
