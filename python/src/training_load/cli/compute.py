"""`compute`: rebuild public.daily_load (2026-01-01 .. today) and public.blocks from the DB.

Runs only after both collectors succeeded (sequential, fail-fast CI steps).
"""

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from training_load.config import ConfigError, compute_config, load_dotenv_file
from training_load.db.activities import all_activities
from training_load.db.blocks import sync_blocks
from training_load.db.client import Postgrest
from training_load.db.daily_load import sync_daily_load
from training_load.db.strength_sets import all_sets
from training_load.domain.cycling import daily_cycling_tss
from training_load.domain.daily import build_daily_load
from training_load.domain.dates import SERIES_START, today_local
from training_load.domain.load import DECAY
from training_load.domain.strength import counted_sets, daily_strength_tss, derive_blocks
from training_load.http import requests_send

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ComputeSummary:
    days: int
    activities: int
    strength_sets: int
    counted_sets: int
    ignored_outside_range: int  # loads dated before SERIES_START or after today
    blocks: int


def run(db: Postgrest, *, strength_k: float, today: date) -> ComputeSummary:
    """1. all_activities + all_sets (paginated)
    2. daily_cycling_tss(activities); daily_strength_tss(sets, today, strength_k)
    3. build_daily_load(start=SERIES_START, end=today) with load.DECAY
    4. sync_daily_load(start=SERIES_START, end=today)
    5. sync_blocks(derive_blocks(sets))
    """
    activities = all_activities(db)
    sets = all_sets(db)
    cycling = daily_cycling_tss(activities)
    strength = daily_strength_tss(sets, today, strength_k)
    ignored = sum(1 for d in (*cycling, *strength) if not SERIES_START <= d <= today)

    days = build_daily_load(cycling, strength, start=SERIES_START, end=today, decay=DECAY)
    sync_daily_load(db, days, start=SERIES_START, end=today)
    blocks = derive_blocks(sets)
    sync_blocks(db, blocks)

    if ignored:
        log.warning(
            "%d daily loads fall outside %s..%s and were ignored", ignored, SERIES_START, today
        )
    return ComputeSummary(
        days=len(days),
        activities=len(activities),
        strength_sets=len(sets),
        counted_sets=len(counted_sets(sets, today)),
        ignored_outside_range=ignored,
        blocks=len(blocks),
    )


def main(argv: Sequence[str] | None = None) -> int:
    """load_dotenv_file -> compute_config(os.environ) -> run(today=today_local()) -> log."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv_file()
    try:
        config = compute_config(os.environ)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    db = Postgrest(config.supabase.url, config.supabase.service_key, requests_send())
    summary = run(db, strength_k=config.strength_k, today=today_local())
    log.info("daily_load rebuilt (%s): %s", DECAY.value, summary)
    return 0
