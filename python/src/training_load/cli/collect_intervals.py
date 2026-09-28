"""`collect-intervals [--since YYYY-MM-DD]`: mirror intervals.icu rides into public.activities.

Default window: today - 14 days .. today (Europe/Copenhagen). Backfill: --since 2026-01-01.
"""

import argparse
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from training_load.config import (
    ConfigError,
    IntervalsSettings,
    collect_intervals_config,
    load_dotenv_file,
)
from training_load.db.activities import delete_ids, ids_between, upsert_activities
from training_load.db.client import Postgrest
from training_load.domain.dates import today_local
from training_load.http import HttpSend, requests_send
from training_load.sources.intervals import fetch_activities, parse_activities

DEFAULT_LOOKBACK_DAYS: Final = 14

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class IntervalsRunSummary:
    fetched: int
    upserted: int
    deleted: int
    stubs_skipped: int
    excluded: int
    missing_load: int


def parse_since(argv: Sequence[str] | None, today: date) -> date:
    """--since (ISO date), default today - DEFAULT_LOOKBACK_DAYS. Error if it is after today."""
    parser = argparse.ArgumentParser(
        prog="collect-intervals", description="Mirror intervals.icu rides into Supabase."
    )
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        default=today - timedelta(days=DEFAULT_LOOKBACK_DAYS),
        help=f"first local date to fetch (default: today - {DEFAULT_LOOKBACK_DAYS} days)",
    )
    since: date = parser.parse_args(argv).since
    if since > today:
        parser.error(f"--since {since} is after today ({today})")
    return since


def run(
    intervals: IntervalsSettings, *, send: HttpSend, db: Postgrest, since: date, today: date
) -> IntervalsRunSummary:
    """1. fetch_activities(oldest=since, newest=today + 1 day): covers today whether the
          API treats ``newest`` as inclusive or exclusive.
    2. parse_activities; log a WARNING with the count (and ids) of Strava stubs and of rides
       with a null load.
    3. upsert the cycling activities.
    4. Mirror deletions, window [since, today] only:
       stale = ids_between(db, since, today) - cycling ids - stub ids; delete_ids(stale).
    """
    raw = fetch_activities(
        send,
        api_key=intervals.api_key,
        athlete_id=intervals.athlete_id,
        oldest=since,
        newest=today + timedelta(days=1),
    )
    parsed = parse_activities(raw)
    if parsed.stub_ids:
        log.warning(
            "%d Strava-sourced activities skipped: intervals.icu does not expose them via its "
            "API (ids: %s). Sync rides to intervals.icu directly (e.g. Zwift/Garmin) instead.",
            len(parsed.stub_ids),
            ", ".join(parsed.stub_ids[:10]),
        )
    if parsed.missing_load_ids:
        log.warning(
            "%d rides have no training load; counted as 0 (ids: %s)",
            len(parsed.missing_load_ids),
            ", ".join(parsed.missing_load_ids[:10]),
        )

    upsert_activities(db, parsed.cycling)
    keep = {a.id for a in parsed.cycling} | set(parsed.stub_ids)
    stale = ids_between(db, since, today) - keep
    delete_ids(db, stale)

    return IntervalsRunSummary(
        fetched=len(raw),
        upserted=len(parsed.cycling),
        deleted=len(stale),
        stubs_skipped=len(parsed.stub_ids),
        excluded=sum(parsed.excluded_types.values()),
        missing_load=len(parsed.missing_load_ids),
    )


def main(argv: Sequence[str] | None = None) -> int:
    """load_dotenv_file -> collect_intervals_config(os.environ) -> run -> log summary."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    today = today_local()
    since = parse_since(argv, today)
    load_dotenv_file()
    try:
        config = collect_intervals_config(os.environ)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    send = requests_send()
    db = Postgrest(config.supabase.url, config.supabase.service_key, send)
    summary = run(config.intervals, send=send, db=db, since=since, today=today)
    log.info("intervals.icu %s..%s: %s", since, today, summary)
    return 0
