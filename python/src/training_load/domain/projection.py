"""Prognose: CTL/ATL/TSB for the next HORIZON_DAYS days (the future half of the /load chart).

Python owns the numbers; the web only draws them. Every future load is an ESTIMATE (decided
with the user, 2026-09-30):
  cycling   a planned ride's TSS replaces that day (NP-style from its steps' %FTP); every other
            day gets the typical week: mean cycling TSS per weekday over the last TYPICAL_DAYS.
  strength  inside the block ("plan"): every session still to do is scored from the coach's
            prescription with the unchanged score formula and planned kg (domain.planned_load),
            times STRENGTH_K, assuming every planned session is done (decided 2026-10-01).
            After the block ("recent"): the mean weekly strength TSS of the last RECENT_WEEKS
            completed, non-deload weeks, split over the sessions, with their min-max as a band.
            Sessions land on the user's typical weekday for that number (the most common one
            over the last WEEKDAY_WEEKS ISO weeks; if none, spread evenly: round(i * 7 / N)). A
            session whose day has passed this week moves to the next free day from tomorrow.
            Weeks the sheet hasn't planned repeat the latest planned week's session count.
The state going into tomorrow is today's CTL/ATL, decayed with load.DECAY. Nothing becomes a
silent 0: an unreadable planned ride, a session number without done history and a session that
no longer fits this week are all listed in the day's ``basis``.
"""

import math
from collections import Counter
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.daily import DailyLoad
from training_load.domain.load import DECAY, Decay, LoadState, ctl_atl
from training_load.domain.plan import PlanError, PlanItem, Repeat, parse_steps
from training_load.domain.planned_load import planned_session_score
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet, iso_week_start

HORIZON_DAYS: Final = 56
TYPICAL_DAYS: Final = 28
RECENT_WEEKS: Final = 4
WEEKDAY_WEEKS: Final = 4
NAIVE_DAYS: Final = 28
MODEL_VERSION: Final = "plan-v1"
"""Bump when the forecast method changes: forecast_log compares errors per version."""

# basis is stored as jsonb and only ever read as JSON: a JSON object, by construction.
type Basis = dict[str, object]
type StrengthMethod = Literal["plan", "recent"]  # = daily_projection's check constraint


@dataclass(frozen=True, slots=True)
class PlannedRide:
    """A row of public.planned_sessions (filled by hand); steps are validated here."""

    date: date
    name: str
    steps: object


@dataclass(frozen=True, slots=True)
class ProjectedDay:
    """Mirrors a public.daily_projection row."""

    date: date
    cycling_tss: float
    strength_tss: float
    ctl: float
    atl: float
    tsb: float
    basis: Basis
    strength_method: StrengthMethod = "plan"  # "plan" inside the block, "recent" after it
    # The band (low, high) per metric: None inside the block, where the plan is used.
    ctl_band: tuple[float, float] | None = None
    atl_band: tuple[float, float] | None = None
    tsb_band: tuple[float, float] | None = None


def _flat_steps(items: Iterable[PlanItem]) -> Iterator[tuple[float, float]]:
    """(minutes, intensity as a fraction of FTP) per step, repeats expanded, ranges at midpoint."""
    for item in items:
        steps = item.steps * item.repeat if isinstance(item, Repeat) else (item,)
        for step in steps:
            yield step.minutes, (step.pct_low + step.pct_high) / 200


def ride_tss(items: Sequence[PlanItem]) -> float:
    """NP-style TSS: IF = (sum(t * p^4) / sum(t))^(1/4), TSS = hours * IF^2 * 100.

    Like intervals.icu's history, which is NP-based. 60 min at 100% gives 100.
    """
    parts = list(_flat_steps(items))
    minutes = sum(t for t, _ in parts)
    if minutes <= 0:
        return 0.0
    intensity = math.pow(sum(t * p**4 for t, p in parts) / minutes, 0.25)
    return minutes / 60 * intensity**2 * 100


def typical_cycling(days: Sequence[DailyLoad], today: date) -> dict[int, float]:
    """Mean cycling TSS per weekday (0 = Monday) over the TYPICAL_DAYS before today (today's
    row is still empty when the daily job runs at 05:00, so it would pull its weekday down)."""
    first = today - timedelta(days=TYPICAL_DAYS)
    by_weekday: dict[int, list[float]] = {w: [] for w in range(7)}
    for d in days:
        if first <= d.date < today:
            by_weekday[d.date.weekday()].append(d.cycling_tss)
    return {w: sum(v) / len(v) if v else 0.0 for w, v in by_weekday.items()}


def learnt_weekdays(sessions: Sequence[StrengthSession], today: date) -> dict[int, int]:
    """Per session number: the weekday it was done most often over the last WEEKDAY_WEEKS ISO
    weeks (ties: the latest one). Only planned sessions that were done count."""
    oldest = iso_week_start(today) - timedelta(weeks=WEEKDAY_WEEKS - 1)
    done: dict[int, list[date]] = {}
    for s in sessions:
        if s.date is not None and s.block is not None and s.week_start >= oldest:
            done.setdefault(s.session, []).append(s.date)
    weekdays: dict[int, int] = {}
    for n, dates in done.items():
        counts = Counter(d.weekday() for d in dates)
        top = max(counts.values())
        weekdays[n] = max(d for d in dates if counts[d.weekday()] == top).weekday()
    return weekdays


def spread_weekday(session: int, count: int) -> int:
    """Fallback weekday for session n of N when nothing is learnt: round((n - 1) * 7 / N)."""
    return min(6, round((session - 1) * 7 / count))


@dataclass(frozen=True, slots=True)
class RecentWeeks:
    """Weekly strength TSS of the last RECENT_WEEKS completed, non-deload weeks."""

    mean: float
    low: float
    high: float
    weeks: int


def recent_weeks(
    sessions: Sequence[StrengthSession], today: date, deload_weeks: Iterable[date] = ()
) -> RecentWeeks | None:
    """Done planned sessions per ISO week before this week, deload weeks left out; None if none.

    A week with no session done has no total, so it drops out instead of counting as 0 (the
    forecast assumes 100 % completion), and "the last RECENT_WEEKS" can reach back past a break.
    """
    this_week = iso_week_start(today)
    skip = set(deload_weeks)
    totals: dict[date, float] = {}
    for s in sessions:
        done = s.date is not None and s.block is not None
        if done and s.week_start < this_week and s.week_start not in skip:
            totals[s.week_start] = totals.get(s.week_start, 0.0) + s.tss
    latest = [totals[w] for w in sorted(totals)[-RECENT_WEEKS:]]
    if not latest:
        return None
    return RecentWeeks(sum(latest) / len(latest), min(latest), max(latest), len(latest))


def planned_counts(sets: Sequence[StrengthSet]) -> dict[date, int]:
    """Sessions the sheet plans per ISO week start."""
    by_week: dict[date, set[int]] = {}
    for s in sets:
        by_week.setdefault(s.week_start, set()).add(s.session)
    return {week: len(numbers) for week, numbers in by_week.items()}


def _session_load(
    week: date,
    n: int,
    count: int,
    counts: dict[date, int],
    sets: Sequence[StrengthSet],
    recent: RecentWeeks | None,
    strength_k: float,
) -> Basis:
    """The strength TSS of session ``n`` in ``week``: from the plan, or the recent weeks."""
    if week in counts:
        session_sets = [s for s in sets if s.week_start == week and s.session == n]
        planned = planned_session_score(session_sets, sets)
        scored = planned.sets - planned.unscored
        entry: Basis = {
            "method": "plan",
            "tss": planned.score * strength_k if scored else None,
            "unscored": planned.unscored,
            "kg_sources": planned.sources,
        }
        if not scored:
            entry["reason"] = "no kg for any set in the plan"
        return entry
    if recent is None:
        return {"method": "recent", "tss": None, "reason": "no recent weeks to average"}
    return {
        "method": "recent",
        "tss": recent.mean / count,
        "tss_low": recent.low / count,
        "tss_high": recent.high / count,
        "recent_weeks": recent.weeks,
    }


def _strength_plan(
    sessions: Sequence[StrengthSession],
    sets: Sequence[StrengthSet],
    today: date,
    last: date,
    strength_k: float,
    deload_weeks: Iterable[date],
) -> dict[date, list[Basis]]:
    """Per future day: the strength sessions placed on it (see the module docstring)."""
    counts = planned_counts(sets)
    recent = recent_weeks(sessions, today, deload_weeks)
    weekdays = learnt_weekdays(sessions, today)
    this_week = iso_week_start(today)
    done_this_week = sum(1 for s in sessions if s.week_start == this_week and s.date)
    tomorrow = today + timedelta(days=1)
    placed: dict[date, list[Basis]] = {}
    week = this_week
    latest_count = 0
    while week <= last:
        planned_weeks = [w for w in counts if w <= week]
        if week in counts:
            latest_count = counts[week]
        elif planned_weeks:
            latest_count = counts[max(planned_weeks)]
        first_session = done_this_week + 1 if week == this_week else 1
        for n in range(first_session, latest_count + 1):
            learnt = n in weekdays
            day = week + timedelta(days=weekdays[n] if learnt else spread_weekday(n, latest_count))
            moved = False
            if day < tomorrow:  # this week, and its day has passed without the session
                free = [
                    tomorrow + timedelta(days=i)
                    for i in range((week + timedelta(days=6) - tomorrow).days + 1)
                    if tomorrow + timedelta(days=i) not in placed
                ]
                if not free:
                    placed.setdefault(tomorrow, []).append(
                        {
                            "session": n,
                            "tss": None,
                            "weekday": "learnt" if learnt else "spread",
                            "moved": True,
                            "day_estimated": True,
                            "planned_in_sheet": week in counts,
                            "method": "plan" if week in counts else "recent",
                            "reason": "no day left this week",
                        }
                    )
                    continue
                day, moved = free[0], True
            if tomorrow <= day <= last:
                entry: Basis = {
                    "session": n,
                    "weekday": "learnt" if learnt else "spread",
                    "moved": moved,
                    "day_estimated": moved or not learnt,
                    "planned_in_sheet": week in counts,
                    **_session_load(week, n, latest_count, counts, sets, recent, strength_k),
                }
                placed.setdefault(day, []).append(entry)
        week += timedelta(weeks=1)
    return placed


def project(
    days: Sequence[DailyLoad],
    sessions: Sequence[StrengthSession],
    sets: Sequence[StrengthSet],
    rides: Sequence[PlannedRide],
    *,
    today: date,
    strength_k: float,
    deload_weeks: Iterable[date] = (),
    decay: Decay = DECAY,
) -> list[ProjectedDay]:
    """HORIZON_DAYS projected days, tomorrow .. today + HORIZON_DAYS, seeded from today's row.

    ``days`` is the daily_load series just computed (its last row must be ``today``).
    ``deload_weeks`` (ISO week starts) are left out of the "recent" average.
    """
    if not days or days[-1].date != today:
        raise ValueError("the projection starts from today's daily_load row")
    last = today + timedelta(days=HORIZON_DAYS)
    typical = typical_cycling(days, today)
    counts = planned_counts(sets)
    strength = _strength_plan(sessions, sets, today, last, strength_k, deload_weeks)

    rides_by_day: dict[date, list[Basis]] = {}
    for ride in rides:
        if today < ride.date <= last:
            try:
                items = parse_steps(ride.steps)
            except PlanError as exc:
                rides_by_day.setdefault(ride.date, []).append(
                    {"name": ride.name, "tss": None, "reason": str(exc)}
                )
                continue
            rides_by_day.setdefault(ride.date, []).append(
                {"name": ride.name, "tss": ride_tss(items)}
            )

    dates = [today + timedelta(days=i) for i in range(1, HORIZON_DAYS + 1)]
    cycling: list[float] = []
    lifting: list[float] = []
    lifting_low: list[float] = []
    lifting_high: list[float] = []
    bases: list[Basis] = []
    for d in dates:
        planned = rides_by_day.get(d, [])
        ride_loads = [t for r in planned if isinstance(t := r["tss"], float)]
        if ride_loads:
            ride_load, source = sum(ride_loads), "planned"
        else:
            ride_load, source = typical[d.weekday()], "typical_week"
        placed = strength.get(d, [])
        strength_load = sum(t for p in placed if isinstance(t := p["tss"], float))
        cycling.append(ride_load)
        lifting.append(strength_load)
        lifting_low.append(
            sum(t for p in placed if isinstance(t := p.get("tss_low", p["tss"]), float))
        )
        lifting_high.append(
            sum(t for p in placed if isinstance(t := p.get("tss_high", p["tss"]), float))
        )
        bases.append({"cycling": source, "rides": planned, "strength": placed})

    seed = LoadState(ctl=days[-1].ctl, atl=days[-1].atl, tsb=days[-1].tsb)

    def run(strength_series: Sequence[float]) -> list[LoadState]:
        loads = [c + s for c, s in zip(cycling, strength_series, strict=True)]
        return ctl_atl(loads, decay=decay, initial=seed)

    states, lows, highs = run(lifting), run(lifting_low), run(lifting_high)
    result: list[ProjectedDay] = []
    for i, d in enumerate(dates):
        in_block = iso_week_start(d) in counts
        st, lo, hi = states[i], lows[i], highs[i]
        result.append(
            ProjectedDay(
                date=d,
                cycling_tss=cycling[i],
                strength_tss=lifting[i],
                ctl=st.ctl,
                atl=st.atl,
                tsb=st.tsb,
                basis=bases[i],
                strength_method="plan" if in_block else "recent",
                ctl_band=None if in_block else (min(lo.ctl, hi.ctl), max(lo.ctl, hi.ctl)),
                atl_band=None if in_block else (min(lo.atl, hi.atl), max(lo.atl, hi.atl)),
                tsb_band=None if in_block else (min(lo.tsb, hi.tsb), max(lo.tsb, hi.tsb)),
            )
        )
    return result


def naive_projection(
    days: Sequence[DailyLoad], *, today: date, decay: Decay = DECAY
) -> list[ProjectedDay]:
    """The baseline to beat: "the next 8 weeks look like the last 4". Every future day gets the
    mean cycling and strength TSS of the NAIVE_DAYS before today, run through the same decay."""
    if not days or days[-1].date != today:
        raise ValueError("the projection starts from today's daily_load row")
    first = today - timedelta(days=NAIVE_DAYS)
    window = [d for d in days if first <= d.date < today]
    if not window:  # the series' first day: no baseline (never a silent 0)
        return []
    cycling = sum(d.cycling_tss for d in window) / len(window)
    strength = sum(d.strength_tss for d in window) / len(window)
    seed = LoadState(ctl=days[-1].ctl, atl=days[-1].atl, tsb=days[-1].tsb)
    states = ctl_atl([cycling + strength] * HORIZON_DAYS, decay=decay, initial=seed)
    basis: Basis = {"naive_days": len(window)}
    return [
        ProjectedDay(
            date=today + timedelta(days=i + 1),
            cycling_tss=cycling,
            strength_tss=strength,
            ctl=st.ctl,
            atl=st.atl,
            tsb=st.tsb,
            basis=basis,
            strength_method="recent",
        )
        for i, st in enumerate(states)
    ]
