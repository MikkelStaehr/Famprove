"""Prognose: CTL/ATL/TSB for the next HORIZON_DAYS days (the future half of the /load chart).

Python owns the numbers; the web only draws them. Every future load is an ESTIMATE (decided
with the user, 2026-09-30):
  cycling   a planned ride's TSS replaces that day (NP-style from its steps' %FTP); every other
            day gets the typical week: mean cycling TSS per weekday over the last TYPICAL_DAYS.
  strength  each session still to do gets the mean TSS of the last SESSION_HISTORY done
            sessions with the same number, on the user's typical weekday for that number (the
            most common one over the last WEEKDAY_WEEKS ISO weeks; if none, spread evenly:
            round(i * 7 / N)). A session whose day has passed this week moves to the next free
            day from tomorrow. Weeks the sheet hasn't planned yet repeat the latest planned
            week's session count ("the pattern continues").
The state going into tomorrow is today's CTL/ATL, decayed with load.DECAY. Nothing becomes a
silent 0: an unreadable planned ride, a session number without done history and a session that
no longer fits this week are all listed in the day's ``basis``.
"""

import math
from collections import Counter
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from training_load.domain.daily import DailyLoad
from training_load.domain.load import DECAY, Decay, LoadState, ctl_atl
from training_load.domain.plan import PlanError, PlanItem, Repeat, parse_steps
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet, iso_week_start

HORIZON_DAYS: Final = 56
TYPICAL_DAYS: Final = 28
SESSION_HISTORY: Final = 3
WEEKDAY_WEEKS: Final = 4

# basis is stored as jsonb and only ever read as JSON: a JSON object, by construction.
type Basis = dict[str, object]


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
    """Mean cycling TSS per weekday (0 = Monday) over today - TYPICAL_DAYS + 1 .. today."""
    first = today - timedelta(days=TYPICAL_DAYS - 1)
    by_weekday: dict[int, list[float]] = {w: [] for w in range(7)}
    for d in days:
        if first <= d.date <= today:
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


def session_estimate(sessions: Sequence[StrengthSession], session: int) -> float | None:
    """Mean TSS of the last SESSION_HISTORY done planned sessions with this number, or None."""
    done = sorted(
        (s for s in sessions if s.session == session and s.date and s.block is not None),
        key=lambda s: s.date or date.min,
        reverse=True,
    )[:SESSION_HISTORY]
    return sum(s.tss for s in done) / len(done) if done else None


def planned_counts(sets: Sequence[StrengthSet]) -> dict[date, int]:
    """Sessions the sheet plans per ISO week start."""
    by_week: dict[date, set[int]] = {}
    for s in sets:
        by_week.setdefault(s.week_start, set()).add(s.session)
    return {week: len(numbers) for week, numbers in by_week.items()}


def _strength_plan(
    sessions: Sequence[StrengthSession], sets: Sequence[StrengthSet], today: date, last: date
) -> dict[date, list[Basis]]:
    """Per future day: the strength sessions placed on it (see the module docstring)."""
    counts = planned_counts(sets)
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
                        {"session": n, "tss": None, "reason": "no day left this week"}
                    )
                    continue
                day, moved = free[0], True
            if tomorrow <= day <= last:
                estimate = session_estimate(sessions, n)
                entry: Basis = {
                    "session": n,
                    "tss": estimate,
                    "weekday": "learnt" if learnt else "spread",
                    "moved": moved,
                    "day_estimated": moved or not learnt,
                    "planned_in_sheet": week in counts,
                }
                if estimate is None:
                    entry["reason"] = "no done session with this number to learn from"
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
    decay: Decay = DECAY,
) -> list[ProjectedDay]:
    """HORIZON_DAYS projected days, tomorrow .. today + HORIZON_DAYS, seeded from today's row.

    ``days`` is the daily_load series just computed (its last row must be ``today``).
    """
    if not days or days[-1].date != today:
        raise ValueError("the projection starts from today's daily_load row")
    last = today + timedelta(days=HORIZON_DAYS)
    typical = typical_cycling(days, today)
    strength = _strength_plan(sessions, sets, today, last)

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
        bases.append({"cycling": source, "rides": planned, "strength": placed})

    seed = days[-1]
    states = ctl_atl(
        [c + s for c, s in zip(cycling, lifting, strict=True)],
        decay=decay,
        initial=LoadState(ctl=seed.ctl, atl=seed.atl, tsb=seed.tsb),
    )
    return [
        ProjectedDay(
            date=d, cycling_tss=c, strength_tss=s, ctl=st.ctl, atl=st.atl, tsb=st.tsb, basis=b
        )
        for d, c, s, st, b in zip(dates, cycling, lifting, states, bases, strict=True)
    ]
