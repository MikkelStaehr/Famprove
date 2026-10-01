"""`compute`: rebuild public.strength_sessions, public.daily_load (2026-01-01 .. today),
public.blocks, the prognose and the ride analysis (ride_metrics, cycling_weeks from 2024-12-30)
from the DB.

Runs only after both collectors succeeded (sequential, fail-fast CI steps).
"""

import logging
import os
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final

from training_load.config import ConfigError, compute_config, load_dotenv_file
from training_load.db.activities import all_activities
from training_load.db.blocks import sync_blocks
from training_load.db.client import Postgrest
from training_load.db.daily_load import sync_daily_load
from training_load.db.daily_projection import sync_projection
from training_load.db.forecast_log import log_forecast
from training_load.db.planned import all_sessions
from training_load.db.ride_metrics import sync_ride_metrics
from training_load.db.strength_activities import all_strength_activities
from training_load.db.strength_analysis import (
    all_kg_states,
    sync_strength_weeks,
    upsert_kg_states,
)
from training_load.db.strength_sessions import sync_strength_sessions
from training_load.db.strength_sets import all_sets
from training_load.domain.cycling import daily_cycling_tss
from training_load.domain.daily import build_daily_load
from training_load.domain.dates import ANALYSIS_START, SERIES_START, today_local
from training_load.domain.kg_history import kg_keys, next_kg_state
from training_load.domain.load import DECAY
from training_load.domain.projection import MODEL_VERSION, PlannedRide, naive_projection, project
from training_load.domain.ride_analysis import analyse_rides, weekly_totals
from training_load.domain.sessions import daily_strength_tss, match_sessions
from training_load.domain.strength import derive_blocks, iso_week_start
from training_load.domain.strength_analysis import (
    PHASES_CONFIRMED_TO,
    kg_statuses,
    phase_of,
    set_key,
    strength_weeks,
)
from training_load.http import requests_send
from training_load.sources.intervals import ride_facts

log = logging.getLogger(__name__)

MAX_RIDE_PROBLEM_SHARE: Final = 0.2
"""compute fails (after writing everything) when more rides than this lack raw or have an
unreadable raw field: the backfill is missing or intervals.icu changed its format."""


class RideDataError(RuntimeError):
    """Too many rides could not be analysed; the counts are in the message (no values)."""


@dataclass(frozen=True, slots=True)
class ComputeSummary:
    days: int
    activities: int
    strength_sets: int
    strength_activities: int
    sessions_done: int  # planned sessions matched to an activity
    extra_sessions: int  # activities beyond the planned sessions (0 TSS)
    ignored_outside_range: (
        int  # loads after today, or before their series (cycling: ANALYSIS_START)
    )
    blocks: int
    projected_days: int
    logged_forecast_rows: int
    projection_notes: int  # unreadable planned rides / sessions without history or a day
    unscored_planned_sets: int  # planned sets without a kg rule (left out, never 0)
    rides_analysed: int  # rides since ANALYSIS_START in ride_metrics
    rides_excluded: dict[str, int]  # per exclusion reason (left out of the trends, still shown)
    cycling_weeks: int
    strength_weeks: int
    e1rm_out_of_bounds: int  # candidate sets with an implausible e1RM (left out)
    kg_states_changed: int  # strength_set_kg rows written this run


def run(db: Postgrest, *, strength_k: float, today: date, computed_at: datetime) -> ComputeSummary:
    """1. all_activities + all_sets + all_strength_activities (paginated)
    2. match_sessions(sets, strength activities, strength_k) -> sync_strength_sessions
    3. daily_cycling_tss(activities); daily_strength_tss(sessions) (on the activity dates)
    4. build_daily_load(start=SERIES_START, end=today) with load.DECAY
    5. sync_daily_load(start=SERIES_START, end=today, computed_at=run start, UTC)
    6. sync_blocks(derive_blocks(sets, today))
    7. project the next 56 days (domain.projection) from today's state: the typical week and
       planned_sessions for cycling, the coach's plan (then the recent weeks) for strength ->
       sync_projection; log it with the naive baseline in forecast_log (made_on = today)
    8. the strength analysis: strength_weeks (rebuilt) and the kg history strength_set_kg
       (only changed rows; never rebuilt)
    9. the ride analysis: every ride since ANALYSIS_START -> ride_metrics + cycling_weeks;
       raises RideDataError afterwards when too many rides lack raw or have unreadable fields
    """
    activities = all_activities(db)
    sets = all_sets(db)
    lifts = all_strength_activities(db)
    sessions = match_sessions(sets, lifts, strength_k)
    sync_strength_sessions(db, sessions)
    cycling = daily_cycling_tss(activities)
    strength = daily_strength_tss(sessions)
    # Cycling before SERIES_START is stored for the ride analysis only (not an ignored load).
    ignored = sum(1 for d in cycling if not ANALYSIS_START <= d <= today) + sum(
        1 for d in strength if not SERIES_START <= d <= today
    )

    days = build_daily_load(cycling, strength, start=SERIES_START, end=today, decay=DECAY)
    sync_daily_load(db, days, start=SERIES_START, end=today, computed_at=computed_at)
    blocks = derive_blocks(sets, today)
    sync_blocks(db, blocks)
    for b in blocks:
        if b.block_no > PHASES_CONFIRMED_TO:
            log.warning(
                "blok %d: phase %s is inherited, not confirmed (domain.strength_analysis.PHASES)",
                b.block_no,
                phase_of(b.block_no),
            )

    done = {
        (s.week_start, s.session)
        for s in sessions
        if s.block is not None and s.activity_id is not None
    }
    statuses = kg_statuses(sets, done, today)
    analysis = strength_weeks(sets, statuses, blocks, today=today)
    sync_strength_weeks(db, analysis.weeks, computed_at=computed_at)
    previous = all_kg_states(db)
    keys = kg_keys(sets)
    changed = []
    for st in sets:
        key = keys[set_key(st)]
        before = previous.get(key)
        after = next_kg_state(before, st, key, statuses[set_key(st)], computed_at)
        if after != before:
            changed.append(after)
    upsert_kg_states(db, changed)
    if analysis.e1rm_out_of_bounds:
        log.warning("%d sets left out of e1RM (implausible value)", analysis.e1rm_out_of_bounds)

    rides = [PlannedRide(date=p.date, name=p.name, steps=p.steps) for p in all_sessions(db)]
    deload_weeks = {iso_week_start(b.deload_start) for b in blocks if b.deload_start}
    projection = project(
        days,
        sessions,
        sets,
        rides,
        today=today,
        strength_k=strength_k,
        deload_weeks=deload_weeks,
        decay=DECAY,
    )
    sync_projection(db, projection, computed_at=computed_at)
    logged = log_forecast(
        db,
        made_on=today,
        model=projection,
        naive=naive_projection(days, today=today, decay=DECAY),
        params={"model_version": MODEL_VERSION, "strength_k": strength_k, "decay": DECAY.value},
        computed_at=computed_at,
    )
    notes = sum(
        1
        for p in projection
        for entry in (*_entries(p.basis, "rides"), *_entries(p.basis, "strength"))
        if "reason" in entry
    )
    unscored = sum(
        n
        for p in projection
        for e in _entries(p.basis, "strength")
        if isinstance(n := e.get("unscored"), int)
    )
    # Counts only: the Actions logs are public. The details are in daily_projection.basis.
    if notes:
        log.warning("%d projection entries are estimates without data (see basis)", notes)
    if unscored:
        log.warning("%d planned sets have no kg rule and are left out of the forecast", unscored)

    if ignored:
        log.warning(
            "%d daily loads fall outside their series (cycling from %s, strength from %s, "
            "to %s) and were ignored",
            ignored,
            ANALYSIS_START,
            SERIES_START,
            today,
        )

    unreadable: Counter[str] = Counter()
    facts = []
    unreadable_rides = 0  # rides with at least one unreadable raw field
    for a in activities:
        if ANALYSIS_START <= a.start_date_local.date() <= today:
            fields_before = unreadable.total()
            facts.append(ride_facts(a, unreadable))
            unreadable_rides += unreadable.total() > fields_before
    metrics = analyse_rides(facts)
    weeks = weekly_totals(metrics, first=ANALYSIS_START, last=today)
    sync_ride_metrics(db, metrics, weeks, computed_at=computed_at)
    excluded = Counter(m.exclusion for m in metrics if m.exclusion is not None)
    no_moving = sum(1 for f in facts if f.moving_s is None)
    no_load = sum(1 for f in facts if f.load is None)
    if excluded:
        log.info("rides left out of the trends: %s", dict(sorted(excluded.items())))
    if no_moving:
        log.warning("%d rides have no moving time (they add 0 h to cycling_weeks)", no_moving)
    if no_load:
        log.warning(
            "%d rides have no load (they add 0 to cycling_weeks, as in daily_load)", no_load
        )
    if unreadable:
        log.warning(
            "unreadable raw ride fields (set to null): %s", dict(sorted(unreadable.items()))
        )
    problems = excluded["no_raw"] + unreadable_rides  # a ride without raw has no fields to read
    if facts and problems > MAX_RIDE_PROBLEM_SHARE * len(facts):
        raise RideDataError(
            f"{excluded['no_raw']} of {len(facts)} rides have no raw and {unreadable_rides} have "
            f"unreadable raw fields: run collect-intervals --since {ANALYSIS_START} (backfill)"
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
        logged_forecast_rows=logged,
        projection_notes=notes,
        unscored_planned_sets=unscored,
        rides_analysed=len(metrics),
        rides_excluded=dict(sorted(excluded.items())),
        cycling_weeks=len(weeks),
        strength_weeks=len(analysis.weeks),
        e1rm_out_of_bounds=analysis.e1rm_out_of_bounds,
        kg_states_changed=len(changed),
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
