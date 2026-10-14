"""`collect-intervals [--since YYYY-MM-DD]`: mirror intervals.icu rides into public.activities
and strength activities (WeightTraining) into public.strength_activities.

Default window: today - 14 days .. today (Europe/Copenhagen). Backfill: --since 2024-12-30
(the ride analysis starts there, the ISO week of 2025-01-01; daily_load from 2026-01-01).
"""

import argparse
import logging
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Final

import requests

from training_load.config import (
    ConfigError,
    IntervalsSettings,
    collect_intervals_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db import planned_events, strength_activities
from training_load.db.activities import delete_ids, ids_between, stored_warnings, upsert_activities
from training_load.db.client import Postgrest
from training_load.domain.cycling import CyclingActivity
from training_load.domain.dates import ANALYSIS_START, today_local
from training_load.domain.power_check import data_warning, largest_spike, needs_stream, spike_floor
from training_load.domain.projection import HORIZON_DAYS
from training_load.domain.strength import iso_week_start
from training_load.http import HttpError, HttpSend, requests_send
from training_load.narrow import opt_float, opt_int
from training_load.sources.intervals import (
    fetch_activities,
    fetch_events,
    fetch_power_stream,
    parse_activities,
    parse_events,
)

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
    streams_unread: int = (
        0  # streams that failed or had no watts: the ride keeps its stored warning
    )
    power_unreadable: int = 0  # rides whose max power or ePmax couldn't be read


MAX_POWER_UNREADABLE_SHARE: Final = 0.1
"""Fail the run when more than this share of the rides has an unreadable max power or ePmax:
the API's shape has probably changed, and the warnings would silently stop."""


class PowerDataError(RuntimeError):
    """Too many rides had unreadable power fields; the rides were written, the run fails."""


@dataclass(frozen=True, slots=True)
class PowerChecks:
    rides: list[CyclingActivity]
    read: int  # streams fetched and checked
    unread: int  # streams that failed or had no watts: those rides keep their stored warning
    unreadable: int  # rides whose max power or ePmax couldn't be read


def _read[T](
    raw: Mapping[str, object], key: str, narrow: Callable[[Mapping[str, object], str], T | None]
) -> tuple[T | None, bool]:
    """(value, unreadable): a wrongly typed field is None and counted, never a silent default."""
    try:
        return narrow(raw, key), False
    except ValueError:
        return None, True


def with_power_checks(
    rides: Sequence[CyclingActivity],
    *,
    send: HttpSend,
    api_key: str,
    stored: Mapping[str, str | None] | None = None,
) -> PowerChecks:
    """Each ride with its data_warning (domain.power_check). The power stream is fetched only
    where the max power is above 2 x the ride's FTP and the ePmax is known. A stream that fails,
    or has no watts, is counted as unread and the ride keeps its ``stored`` warning (it may hold
    a single-sample finding); without one it is judged on the peak rule. Unreadable power fields
    are counted."""
    stored = stored or {}
    out: list[CyclingActivity] = []
    read = unread = unreadable = 0
    for a in rides:
        raw = a.raw or {}
        max_w, bad_max = _read(raw, "icu_pm_p_max", opt_int)
        epmax, bad_epmax = _read(raw, "icu_rolling_p_max", opt_float)
        unreadable += bad_max or bad_epmax
        spike = None
        stream_unread = False
        floor = spike_floor(epmax)
        if floor is not None and needs_stream(max_w, a.ftp):
            try:
                stream = fetch_power_stream(send, api_key=api_key, activity_id=a.id)
            except HttpError, ValueError, requests.RequestException:
                stream = None
            if stream is None:
                stream_unread = True
                unread += 1
            else:
                read += 1
                spike = largest_spike(stream[0], stream[1], floor_w=floor)
        warning = data_warning(max_w, epmax, spike)
        if stream_unread and stored.get(a.id) is not None:
            warning = stored[a.id]
        out.append(replace(a, data_warning=warning))
    return PowerChecks(rides=out, read=read, unread=unread, unreadable=unreadable)


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

    checks = with_power_checks(
        parsed.cycling,
        send=send,
        api_key=intervals.api_key,
        stored=stored_warnings(db, since, today),
    )
    rides = checks.rides
    # Counts only (public logs).
    if checks.unread:
        log.warning(
            "%d power streams could not be read: those rides keep their stored power warning",
            checks.unread,
        )
    if checks.unreadable:
        log.warning("%d rides have an unreadable max power or ePmax", checks.unreadable)
    upsert_activities(db, rides)
    strength_activities.upsert_strength_activities(db, parsed.strength)
    stubs = set(parsed.stub_ids)
    stale = ids_between(db, since, today) - {a.id for a in parsed.cycling} - stubs
    delete_ids(db, stale)
    stale_strength = (
        strength_activities.ids_between(db, since, today) - {a.id for a in parsed.strength} - stubs
    )
    strength_activities.delete_ids(db, stale_strength)

    summary = IntervalsRunSummary(
        fetched=len(raw),
        upserted=len(parsed.cycling),
        strength_upserted=len(parsed.strength),
        deleted=len(stale) + len(stale_strength),
        stubs_skipped=len(parsed.stub_ids),
        excluded=sum(parsed.excluded_types.values()),
        missing_load=len(parsed.missing_load_ids),
        data_warnings=sum(1 for a in rides if a.data_warning is not None),
        streams_read=checks.read,
        streams_unread=checks.unread,
        power_unreadable=checks.unreadable,
    )
    if rides and checks.unreadable > MAX_POWER_UNREADABLE_SHARE * len(rides):
        raise PowerDataError(
            f"{checks.unreadable} of {len(rides)} rides have an unreadable max power or ePmax "
            "(intervals.icu fields icu_pm_p_max / icu_rolling_p_max): the power check is off"
        )
    return summary


MAX_EVENT_SKIP_SHARE: Final = 0.5
"""Fail the run when more than this share of the calendar objects can't be read (junk is
counted and logged per run; above the threshold the API shape has changed)."""


@dataclass(frozen=True, slots=True)
class EventsRunSummary:
    fetched: int
    upserted: int
    deleted: int
    skipped: int  # objects without a readable id, category or date
    planned_rides: int  # WORKOUT Ride/VirtualRide events in the window
    rides_without_load: int  # planned rides with no load estimate (compute uses the typical day)


class EventsShapeError(RuntimeError):
    """Too many calendar objects were unreadable; the readable ones were written, the run fails."""


def events_window(today: date) -> tuple[date, date]:
    """This ISO week's Monday .. the Sunday of the week holding today + HORIZON_DAYS: every week
    the prognose touches, whole (the week rule needs all of a week's planned rides)."""
    last = iso_week_start(today + timedelta(days=HORIZON_DAYS)) + timedelta(days=6)
    return iso_week_start(today), last


def run_events(
    intervals: IntervalsSettings,
    *,
    send: HttpSend,
    db: Postgrest,
    today: date,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> EventsRunSummary:
    """Mirror the intervals.icu calendar into public.planned_events (answers round, 2026-10-14):
    1. fetch_events over events_window(today), one day of margin on both edges;
    2. parse_events: junk skipped and counted, a planned ride without a load kept with load
       null and counted (counts only in the log: the Actions logs are public);
    3. upsert every event on its id; mirror deletions inside the window only."""
    first, last = events_window(today)
    raw = fetch_events(
        send,
        api_key=intervals.api_key,
        athlete_id=intervals.athlete_id,
        oldest=first - timedelta(days=1),
        newest=last + timedelta(days=1),
    )
    parsed = parse_events(raw)
    if parsed.skipped:
        log.warning("%d calendar events could not be read and were left out", parsed.skipped)
    if parsed.rides_without_load:
        log.warning(
            "%d planned rides have no load in intervals.icu: those days use the typical week",
            parsed.rides_without_load,
        )
    planned_events.upsert_events(db, parsed.events, fetched_at=now())
    stale = planned_events.ids_between(db, first, last) - {e.id for e in parsed.events}
    planned_events.delete_ids(db, stale)
    summary = EventsRunSummary(
        fetched=len(raw),
        upserted=len(parsed.events),
        deleted=len(stale),
        skipped=parsed.skipped,
        planned_rides=sum(
            1 for e in parsed.events if e.is_planned_ride and first <= e.date <= last
        ),
        rides_without_load=parsed.rides_without_load,
    )
    if raw and parsed.skipped > MAX_EVENT_SKIP_SHARE * len(raw):
        raise EventsShapeError(
            f"{parsed.skipped} of {len(raw)} intervals.icu calendar events could not be read "
            "(id, category or start_date_local)"
        )
    return summary


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
    events = run_events(config.intervals, send=send, db=db, today=today)
    log.info("intervals.icu calendar %s..%s: %s", *events_window(today), events)
    return 0
