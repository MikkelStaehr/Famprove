"""`compute`: rebuild public.strength_sessions, public.daily_load (2026-01-01 .. today) and
public.blocks from the DB.

Runs only after both collectors succeeded (sequential, fail-fast CI steps).
"""

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime

from training_load.config import ConfigError, compute_config, load_dotenv_file
from training_load.db.activities import all_activities
from training_load.db.blocks import sync_blocks
from training_load.db.client import Postgrest
from training_load.db.daily_load import sync_daily_load
from training_load.db.daily_projection import sync_projection
from training_load.db.planned import all_sessions
from training_load.db.strength_activities import all_strength_activities
from training_load.db.strength_sessions import sync_strength_sessions
from training_load.db.strength_sets import all_sets
from training_load.domain.cycling import daily_cycling_tss
from training_load.domain.daily import build_daily_load
from training_load.domain.dates import SERIES_START, today_local
from training_load.domain.load import DECAY
from training_load.domain.projection import PlannedRide, project
from training_load.domain.sessions import daily_strength_tss, match_sessions
from training_load.domain.strength import derive_blocks
from training_load.http import requests_send

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ComputeSummary:
    days: int
    activities: int
    strength_sets: int
    strength_activities: int
    sessions_done: int  # planned sessions matched to an activity
    extra_sessions: int  # activities beyond the planned sessions (0 TSS)
    ignored_outside_range: int  # loads dated before SERIES_START or after today
    blocks: int
    projected_days: int
    projection_notes: int  # unreadable planned rides / sessions without history or a day


def run(db: Postgrest, *, strength_k: float, today: date, computed_at: datetime) -> ComputeSummary:
    """1. all_activities + all_sets + all_strength_activities (paginated)
    2. match_sessions(sets, strength activities, strength_k) -> sync_strength_sessions
    3. daily_cycling_tss(activities); daily_strength_tss(sessions) (on the activity dates)
    4. build_daily_load(start=SERIES_START, end=today) with load.DECAY
    5. sync_daily_load(start=SERIES_START, end=today, computed_at=run start, UTC)
    6. sync_blocks(derive_blocks(sets, today))
    7. project the next 56 days (domain.projection) from today's state, the typical week,
       planned_sessions and the strength sessions -> sync_projection
    """
    activities = all_activities(db)
    sets = all_sets(db)
    lifts = all_strength_activities(db)
    sessions = match_sessions(sets, lifts, strength_k)
    sync_strength_sessions(db, sessions)
    cycling = daily_cycling_tss(activities)
    strength = daily_strength_tss(sessions)
    ignored = sum(1 for d in (*cycling, *strength) if not SERIES_START <= d <= today)

    days = build_daily_load(cycling, strength, start=SERIES_START, end=today, decay=DECAY)
    sync_daily_load(db, days, start=SERIES_START, end=today, computed_at=computed_at)
    blocks = derive_blocks(sets, today)
    sync_blocks(db, blocks)

    rides = [PlannedRide(date=p.date, name=p.name, steps=p.steps) for p in all_sessions(db)]
    projection = project(days, sessions, sets, rides, today=today, decay=DECAY)
    sync_projection(db, projection, computed_at=computed_at)
    notes = sum(
        1
        for p in projection
        for entry in (*_entries(p.basis, "rides"), *_entries(p.basis, "strength"))
        if "reason" in entry
    )
    if notes:
        # Counts only: the Actions logs are public. The details are in daily_projection.basis.
        log.warning("%d projection entries are estimates without data (see basis)", notes)

    if ignored:
        log.warning(
            "%d daily loads fall outside %s..%s and were ignored", ignored, SERIES_START, today
        )
    return ComputeSummary(
        days=len(days),
        activities=len(activities),
        strength_sets=len(sets),
        strength_activities=len(lifts),
        sessions_done=sum(1 for s in sessions if s.block is not None and s.activity_id is not None),
        extra_sessions=sum(1 for s in sessions if s.block is None),
        ignored_outside_range=ignored,
        blocks=len(blocks),
        projected_days=len(projection),
        projection_notes=notes,
    )


def _entries(basis: dict[str, object], key: str) -> list[dict[str, object]]:
    value = basis.get(key)
    return [e for e in value if isinstance(e, dict)] if isinstance(value, list) else []


def main(argv: Sequence[str] | None = None) -> int:
    """load_dotenv_file -> compute_config(os.environ) -> run(today, computed_at=now) -> log."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv_file()
    try:
        config = compute_config(os.environ)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    db = Postgrest(config.supabase.url, config.supabase.service_key, requests_send())
    now = datetime.now(UTC)
    summary = run(db, strength_k=config.strength_k, today=today_local(now), computed_at=now)
    log.info("daily_load rebuilt (%s): %s", DECAY.value, summary)
    return 0
