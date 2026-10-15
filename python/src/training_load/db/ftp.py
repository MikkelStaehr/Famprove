"""public.ftp_status (one row, written by collect-plan) and public.ftp_ack (the user's answers to
the FTP notice, written by the web; read here). Slice ftp-confirm, user 2026-10-15."""

from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import JsonRow, Postgrest
from training_load.domain.ftp_check import FtpAck, FtpStatus
from training_load.narrow import opt_int, req_int, req_str

STATUS_TABLE: Final = "ftp_status"
ACK_TABLE: Final = "ftp_ack"
ACK_COLUMNS: Final = "id,choice,ftp_w,eftp_w,at"


class FtpStatusRow(TypedDict):
    singleton: bool  # always true: the table holds one row
    ftp_w: int | None
    eftp_w: int | None
    best_8min_42d_w: int | None
    threshold_w: int | None
    credible: bool | None
    last_tested_on: str | None  # ISO date
    ftp_since: str | None  # ISO date
    suppressed_until: str | None  # ISO date
    checked_at: str  # ISO timestamptz of the run


def _iso(day: date | None) -> str | None:
    return None if day is None else day.isoformat()


def status_row(status: FtpStatus, *, checked_at: datetime) -> FtpStatusRow:
    return FtpStatusRow(
        singleton=True,
        ftp_w=status.ftp_w,
        eftp_w=status.eftp_w,
        best_8min_42d_w=status.best_8min_42d_w,
        threshold_w=status.threshold_w,
        credible=status.credible,
        last_tested_on=_iso(status.last_tested_on),
        ftp_since=_iso(status.ftp_since),
        suppressed_until=_iso(status.suppressed_until),
        checked_at=checked_at.isoformat(),
    )


def write_status(db: Postgrest, status: FtpStatus, *, checked_at: datetime) -> None:
    db.upsert(STATUS_TABLE, [status_row(status, checked_at=checked_at)], on_conflict="singleton")


def ack_from_row(row: JsonRow) -> FtpAck:
    """Raises ValueError on a row the table's checks should have refused (never guessed)."""
    choice = req_str(row, "choice")
    if choice not in ("confirmed", "fixed"):
        raise ValueError(f"ftp_ack.choice must be confirmed or fixed, not {choice!r}")
    at = datetime.fromisoformat(req_str(row, "at"))
    if at.tzinfo is None:
        raise ValueError("ftp_ack.at must carry a time zone")
    return FtpAck(
        choice="confirmed" if choice == "confirmed" else "fixed",
        ftp_w=req_int(row, "ftp_w"),
        eftp_w=opt_int(row, "eftp_w"),
        at=at,
    )


def latest_ack(db: Postgrest) -> FtpAck | None:
    """The newest answer (highest id); None when the user never answered."""
    rows = db.select(ACK_TABLE, columns=ACK_COLUMNS, order="id")
    return None if not rows else ack_from_row(rows[-1])
