"""`collect-plan`: turn the hand-filled planned_sessions into planned_targets with watts.

Reads the current ride FTP from intervals.icu (read-only) and every planned session, validates
each session's steps (domain.plan) and rebuilds public.planned_targets. A session whose steps
can't be read is kept with its ``problem`` so the Today screen can say what's wrong.

The FTP check (slice ftp-confirm, domain.ftp_check): one more GET for the ride power curves, the
rides' FTP (activities) and the user's newest answer (ftp_ack) -> public.ftp_status and the
ftp_mismatch notice, which shows only while the eFTP is credible and not suppressed. A power
curve that can't be read leaves both as they were and never stops the run.
"""

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime

from training_load.config import (
    ConfigError,
    IntervalsSettings,
    collect_intervals_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db.activities import ride_ftps
from training_load.db.app_notices import set_notice
from training_load.db.client import Postgrest
from training_load.db.ftp import latest_ack, write_status
from training_load.db.planned import PlannedSession, PlannedTarget, all_sessions, sync_targets
from training_load.domain.dates import LOCAL_TZ
from training_load.domain.ftp_check import FtpStatus, ftp_status, notice_message
from training_load.domain.plan import PlanError, parse_steps, targets, total_minutes
from training_load.domain.power_check import FTP_NOTICE_KIND
from training_load.http import HttpError, HttpSend, requests_send
from training_load.sources.intervals import RideFtp, fetch_power_curves, fetch_ride_ftps

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PlanRunSummary:
    sessions: int
    with_problem: int
    deleted: int
    ftp: int | None


def to_target(session: PlannedSession, ftp: int | None) -> PlannedTarget:
    try:
        items = parse_steps(session.steps)
    except PlanError as exc:
        return PlannedTarget(session.date, session.name, session.notes, ftp, 0.0, (), str(exc))
    return PlannedTarget(
        session.date,
        session.name,
        session.notes,
        ftp,
        total_minutes(items),
        targets(items, ftp),
        None,
    )


def check_ftp(
    intervals: IntervalsSettings, ftps: RideFtp, *, send: HttpSend, db: Postgrest, today: date
) -> FtpStatus | None:
    """The FTP status for this run; None when the power curves can't be read (logged: the stored
    status and notice stay as they were)."""
    try:
        curves = fetch_power_curves(
            send, api_key=intervals.api_key, athlete_id=intervals.athlete_id, today=today
        )
    except (HttpError, ValueError) as exc:
        log.warning("FTP check skipped, power curves unreadable: %s", exc)
        return None
    if curves.unreadable:
        log.warning("FTP check: %d power-curve points unreadable, left out", curves.unreadable)
    return ftp_status(
        ftp_w=ftps.ftp,
        eftp_w=ftps.eftp,
        best_42d=curves.best_42d,
        weekly=curves.weekly,
        rides=ride_ftps(db),
        ack=latest_ack(db),
        today=today,
    )


def run(
    intervals: IntervalsSettings, *, send: HttpSend, db: Postgrest, computed_at: datetime
) -> PlanRunSummary:
    ftps = fetch_ride_ftps(send, api_key=intervals.api_key, athlete_id=intervals.athlete_id)
    ftp = ftps.ftp
    if ftps.ftp is None or ftps.eftp is None:
        log.warning("FTP check: intervals.icu has no %s", "FTP" if ftps.ftp is None else "eFTP")
    today = computed_at.astimezone(LOCAL_TZ).date()
    status = check_ftp(intervals, ftps, send=send, db=db, today=today)
    if status is not None:
        write_status(db, status, checked_at=computed_at)
        notice = notice_message(status)
        set_notice(db, FTP_NOTICE_KIND, notice, today=today, now=computed_at)
        log.info(
            "FTP check: FTP %s W, eFTP %s W, best 8 min in 42 d %s W (credible from %s W: %s), "
            "last tested %s, suppressed until %s, notice %s",
            status.ftp_w,
            status.eftp_w,
            status.best_8min_42d_w,
            status.threshold_w,
            status.credible,
            status.last_tested_on,
            status.suppressed_until,
            "shown" if notice is not None else "none",
        )
    if ftp is None:
        log.warning("intervals.icu has no ride FTP: planned targets get no watts")
    planned = [to_target(s, ftp) for s in all_sessions(db)]
    problems = [t for t in planned if t.problem is not None]
    if problems:
        log.warning(
            "%d planned sessions have unreadable steps (see planned_targets.problem)", len(problems)
        )
    deleted = sync_targets(db, planned, computed_at=computed_at)
    return PlanRunSummary(len(planned), len(problems), deleted, ftp)


def main(argv: Sequence[str] | None = None) -> int:
    """load_dotenv_file -> collect_intervals_config(os.environ) -> run -> log summary."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv_file()
    try:
        config = collect_intervals_config(os.environ)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    mask_in_ci(config.intervals.athlete_id)
    send = requests_send()
    db = Postgrest(config.supabase.url, config.supabase.service_key, send)
    summary = run(config.intervals, send=send, db=db, computed_at=datetime.now(UTC))
    log.info("planned_targets rebuilt: %s", summary)
    return 0
