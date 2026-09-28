"""`collect-plan`: turn the hand-filled planned_sessions into planned_targets with watts.

Reads the current ride FTP from intervals.icu (read-only) and every planned session, validates
each session's steps (domain.plan) and rebuilds public.planned_targets. A session whose steps
can't be read is kept with its ``problem`` so the Today screen can say what's wrong.
"""

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from training_load.config import (
    ConfigError,
    IntervalsSettings,
    collect_intervals_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db.client import Postgrest
from training_load.db.planned import PlannedSession, PlannedTarget, all_sessions, sync_targets
from training_load.domain.plan import PlanError, parse_steps, targets, total_minutes
from training_load.http import HttpSend, requests_send
from training_load.sources.intervals import fetch_ride_ftp

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


def run(
    intervals: IntervalsSettings, *, send: HttpSend, db: Postgrest, computed_at: datetime
) -> PlanRunSummary:
    ftp = fetch_ride_ftp(send, api_key=intervals.api_key, athlete_id=intervals.athlete_id)
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
