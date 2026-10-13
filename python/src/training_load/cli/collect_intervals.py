"""`collect-intervals [--since YYYY-MM-DD]`: mirror intervals.icu rides into public.activities
and strength activities (WeightTraining) into public.strength_activities.

Default window: today - 14 days .. today (Europe/Copenhagen). Backfill: --since 2024-12-30
(the ride analysis starts there, the ISO week of 2025-01-01; daily_load from 2026-01-01).
"""

import argparse
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Final

from training_load.config import (
    ConfigError,
    IntervalsSettings,
    collect_intervals_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db import strength_activities
from training_load.db.activities import delete_ids, ids_between, upsert_activities
from training_load.db.client import Postgrest
from training_load.domain.cycling import CyclingActivity
from training_load.domain.dates import ANALYSIS_START, today_local
from training_load.domain.power_check import data_warning, largest_spike, needs_stream
from training_load.http import HttpError, HttpSend, requests_send
from training_load.narrow import opt_float, opt_int
from training_load.sources.intervals import fetch_activities, fetch_power_stream, parse_activities

DEFAULT_LOOKBACK_DAYS: Final = 14

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class IntervalsRunSummary:
    fetched: int
    upserted: int
    strength_upserted: int
    deleted: int
    stubs_skipped: int
    excluded: int
    missing_load: int
    data_warnings: int = 0  # rides with a power-data warning (domain.power_check)
    streams_read: int = 0  # power streams fetched for the single-sample rule
    streams_unread: int = 0  # stream fetches that failed: those rides were checked on the peak only


def with_power_checks(
    rides: Sequence[CyclingActivity], *, send: HttpSend, api_key: str
) -> tuple[list[CyclingActivity], int, int]:
    """Each ride with its data_warning (domain.power_check). The power stream is fetched only
    where the max power is above 2 x the ride's FTP; a fetch that fails is counted, and that
    ride is judged on the peak rule alone (never silently "no spike"). Returns (rides, read,
    unread)."""
    out: list[CyclingActivity] = []
    read = unread = 0
    for a in rides:
        raw = a.raw or {}
        try:
            max_w = opt_int(raw, "icu_pm_p_max")
            epmax = opt_float(raw, "icu_rolling_p_max")
        except ValueError:
            max_w, epmax = None, None  # unreadable raw: counted by compute's ride analysis
        spike = None
        if needs_stream(max_w, a.ftp):
            try:
                stream = fetch_power_stream(send, api_key=api_key, activity_id=a.id)
                read += 1
                if stream is not None:
                    spike = largest_spike(stream[0], stream[1])
            except HttpError, ValueError:
                unread += 1
        out.append(replace(a, data_warning=data_warning(max_w, epmax, spike)))
    return out, read, unread


def parse_since(argv: Sequence[str] | None, today: date) -> date:
    """--since (ISO date), default today - DEFAULT_LOOKBACK_DAYS. Error if it is after today or
    before ANALYSIS_START: nothing before it is used, and the window also bounds the mirrored
    deletions (a since of 0001-01-01 would fetch and mirror all history)."""
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
    if since < ANALYSIS_START:
        parser.error(f"--since {since} is before {ANALYSIS_START} (the earliest date used)")
    return since


def run(
    intervals: IntervalsSettings, *, send: HttpSend, db: Postgrest, since: date, today: date
) -> IntervalsRunSummary:
    """1. fetch_activities(oldest=since - 1 day, newest=today + 1 day): one day of margin on
          both edges of the delete window, whatever day boundary the API applies.
    2. parse_activities; log a WARNING with the count (never the ids) of Strava stubs and of
       rides with a null load.
    3. upsert the cycling activities and the strength activities (separate tables).
    4. Mirror deletions per table, window [since, today] only:
       stale = ids_between(db, since, today) - that table's ids - stub ids; delete_ids(stale).
    """
    raw = fetch_activities(
        send,
        api_key=intervals.api_key,
        athlete_id=intervals.athlete_id,
        oldest=since - timedelta(days=1),
        newest=today + timedelta(days=1),
    )
    parsed = parse_activities(raw)
    # Counts only: the Actions logs of this public repo are world-readable.
    if parsed.stub_ids:
        log.warning(
            "%d Strava-sourced activities skipped: intervals.icu does not expose them via its "
            "API. Sync rides to intervals.icu directly (e.g. Zwift/Garmin) instead.",
            len(parsed.stub_ids),
        )
    if parsed.missing_load_ids:
        log.warning("%d rides have no training load; counted as 0", len(parsed.missing_load_ids))

    rides, streams_read, streams_unread = with_power_checks(
        parsed.cycling, send=send, api_key=intervals.api_key
    )
    if streams_unread:
        log.warning(
            "%d power streams could not be read: those rides were checked on max power only",
            streams_unread,
        )
    upsert_activities(db, rides)
    strength_activities.upsert_strength_activities(db, parsed.strength)
    stubs = set(parsed.stub_ids)
    stale = ids_between(db, since, today) - {a.id for a in parsed.cycling} - stubs
    delete_ids(db, stale)
    stale_strength = (
        strength_activities.ids_between(db, since, today) - {a.id for a in parsed.strength} - stubs
    )
    strength_activities.delete_ids(db, stale_strength)

    return IntervalsRunSummary(
        fetched=len(raw),
        upserted=len(parsed.cycling),
        strength_upserted=len(parsed.strength),
        deleted=len(stale) + len(stale_strength),
        stubs_skipped=len(parsed.stub_ids),
        excluded=sum(parsed.excluded_types.values()),
        missing_load=len(parsed.missing_load_ids),
        data_warnings=sum(1 for a in rides if a.data_warning is not None),
        streams_read=streams_read,
        streams_unread=streams_unread,
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
    mask_in_ci(config.intervals.athlete_id)
    send = requests_send()
    db = Postgrest(config.supabase.url, config.supabase.service_key, send)
    summary = run(config.intervals, send=send, db=db, since=since, today=today)
    log.info("intervals.icu %s..%s: %s", since, today, summary)
    return 0
