"""`collect-events`: mirror the intervals.icu calendar into public.planned_events (answers
round, user 2026-10-14). Its own step in the daily job, before compute and with
continue-on-error: a calendar problem never blocks compute, which then uses the last mirrored
calendar (reviewer, 2026-10-14).

Window: this ISO week's Monday .. the Sunday of the week holding today + HORIZON_DAYS, so every
week the prognose touches is mirrored whole (the week rule needs all of a week's planned rides).
"""

import logging
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Final

from training_load.config import (
    ConfigError,
    IntervalsSettings,
    collect_intervals_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db import planned_events
from training_load.db.client import Postgrest
from training_load.domain.calendar import events_window
from training_load.domain.dates import today_local
from training_load.http import HttpSend, requests_send
from training_load.sources.intervals import fetch_events, parse_events

log = logging.getLogger(__name__)

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
    """Too many calendar objects were unreadable: the readable ones were written, nothing was
    deleted (a changed shape must never wipe the stored calendar), the run fails."""


def run_events(
    intervals: IntervalsSettings,
    *,
    send: HttpSend,
    db: Postgrest,
    today: date,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> EventsRunSummary:
    """1. fetch_events over events_window(today), one day of margin on both edges;
    2. parse_events: junk skipped and counted, a planned ride without a load kept with load
       null and counted (counts only in the log: the Actions logs are public);
    3. upsert every readable event on its id;
    4. above MAX_EVENT_SKIP_SHARE junk: fail before any deletion; else mirror deletions inside
       the window only."""
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
    if raw and parsed.skipped > MAX_EVENT_SKIP_SHARE * len(raw):
        raise EventsShapeError(
            f"{parsed.skipped} of {len(raw)} intervals.icu calendar events could not be read "
            "(id, category or start_date_local); no stored event was deleted"
        )
    stale = planned_events.ids_between(db, first, last) - {e.id for e in parsed.events}
    planned_events.delete_ids(db, stale)
    return EventsRunSummary(
        fetched=len(raw),
        upserted=len(parsed.events),
        deleted=len(stale),
        skipped=parsed.skipped,
        planned_rides=sum(
            1 for e in parsed.events if e.is_planned_ride and first <= e.date <= last
        ),
        rides_without_load=parsed.rides_without_load,
    )


def main(argv: Sequence[str] | None = None) -> int:
    """load_dotenv_file -> collect_intervals_config(os.environ) -> run_events -> log summary."""
    del argv  # no options
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    today = today_local()
    load_dotenv_file()
    try:
        config = collect_intervals_config(os.environ)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    mask_in_ci(config.intervals.athlete_id)
    send = requests_send()
    db = Postgrest(config.supabase.url, config.supabase.service_key, send)
    summary = run_events(config.intervals, send=send, db=db, today=today)
    log.info("intervals.icu calendar %s..%s: %s", *events_window(today), summary)
    return 0
