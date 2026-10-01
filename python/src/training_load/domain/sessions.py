"""Strength activities and how they date the sheet's sessions.

Rule (agreed with the user): the n-th strength activity of an ISO week (Mon-Sun, ordered by
start time) is session n of that week. A session's strength TSS lands on its activity's
local date. A planned session without an activity has no date and adds nothing; an activity
beyond the planned sessions is an extra with 0 TSS ("not in the program").
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final

from training_load.domain.strength import StrengthSet, iso_week_start

STRENGTH_TYPES: Final = frozenset({"WeightTraining"})
"""intervals.icu types that count as a strength session (Garmin-synced or manual)."""


@dataclass(frozen=True, slots=True)
class StrengthActivity:
    """Mirrors a public.strength_activities row."""

    id: str
    start_date_local: datetime  # naive, athlete-local wall clock; its .date() is the day
    type: str
    name: str | None
    moving_time_s: int | None
    elapsed_time_s: int | None
    training_load: int | None  # intervals.icu's own value; display only
    device_name: str | None
    raw: Mapping[str, object] | None = field(default=None, compare=False)
    """The intervals.icu object as delivered; None for rows stored before raw was kept."""


@dataclass(frozen=True, slots=True)
class StrengthSession:
    """Mirrors a public.strength_sessions row."""

    week_start: date
    session: int
    sheet_id: str | None  # plan side: None for an extra activity
    block: str | None
    week: int | None
    activity_id: str | None  # done side: None until an activity is logged
    date: date | None
    activity_name: str | None
    moving_time_s: int | None
    tss: float  # sum of the session's set scores x STRENGTH_K when planned and done, else 0


def is_strength(activity_type: str | None) -> bool:
    """True iff the intervals.icu type is in STRENGTH_TYPES."""
    return activity_type in STRENGTH_TYPES


@dataclass(frozen=True, slots=True)
class _Planned:
    sheet_id: str
    block: str
    week: int
    score: float


def _planned(sets: Iterable[StrengthSet]) -> dict[tuple[date, int], _Planned]:
    planned: dict[tuple[date, int], _Planned] = {}
    for s in sets:
        key = (s.week_start, s.session)
        known = planned.get(key)
        if known is None:
            planned[key] = _Planned(s.sheet_id, s.block, s.week, s.score)
        elif (known.sheet_id, known.block, known.week) != (s.sheet_id, s.block, s.week):
            raise ValueError(
                f"session {s.session} of the week of {s.week_start} is prescribed twice: "
                f"{known.block!r} week {known.week} and {s.block!r} week {s.week}"
            )
        else:
            planned[key] = _Planned(s.sheet_id, s.block, s.week, known.score + s.score)
    return planned


def _numbered(activities: Iterable[StrengthActivity]) -> dict[tuple[date, int], StrengthActivity]:
    by_week: dict[date, list[StrengthActivity]] = {}
    for a in activities:
        by_week.setdefault(iso_week_start(a.start_date_local.date()), []).append(a)
    numbered: dict[tuple[date, int], StrengthActivity] = {}
    for week_start, week in by_week.items():
        for n, a in enumerate(sorted(week, key=lambda a: (a.start_date_local, a.id)), start=1):
            numbered[(week_start, n)] = a
    return numbered


def match_sessions(
    sets: Sequence[StrengthSet], activities: Sequence[StrengthActivity], k: float
) -> list[StrengthSession]:
    """Every planned session and every strength activity, matched per the module rule.

    ``k`` is STRENGTH_K. Raises ValueError when two sheet weeks claim the same session slot.
    Sorted by (week_start, session).
    """
    planned = _planned(sets)
    done = _numbered(activities)
    sessions: list[StrengthSession] = []
    for key in sorted(planned.keys() | done.keys()):
        plan = planned.get(key)
        activity = done.get(key)
        sessions.append(
            StrengthSession(
                week_start=key[0],
                session=key[1],
                sheet_id=plan.sheet_id if plan else None,
                block=plan.block if plan else None,
                week=plan.week if plan else None,
                activity_id=activity.id if activity else None,
                date=activity.start_date_local.date() if activity else None,
                activity_name=activity.name if activity else None,
                moving_time_s=activity.moving_time_s if activity else None,
                tss=plan.score * k if plan and activity else 0.0,
            )
        )
    return sessions


def daily_strength_tss(sessions: Iterable[StrengthSession]) -> dict[date, float]:
    """Per activity date: sum of the sessions' tss. Undone sessions have no date.

    Not rounded; rounding is a display concern.
    """
    totals: dict[date, float] = {}
    for s in sessions:
        if s.date is not None:
            totals[s.date] = totals.get(s.date, 0.0) + s.tss
    return totals
