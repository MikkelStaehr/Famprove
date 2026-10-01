"""Cycling activity model, the cycling-type filter and daily cycling TSS."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final

CYCLING_TYPES: Final = frozenset({"Ride", "VirtualRide"})
"""Agreed decision: only these reach cycling TSS. WeightTraining dates strength sessions
(domain.sessions); every other type is excluded."""


@dataclass(frozen=True, slots=True)
class CyclingActivity:
    id: str
    start_date_local: datetime  # naive, athlete-local wall clock; its .date() is the load day
    type: str
    name: str | None
    training_load: int | None  # icu_training_load (power TSS, or HR-based when no power)
    weighted_avg_watts: int | None
    intensity_pct: float | None  # icu_intensity, a percent (85.3 == IF 0.853)
    ftp: int | None
    moving_time_s: int | None
    elapsed_time_s: int | None
    power_load: int | None
    hr_load: int | None
    device_name: str | None = None  # intervals.icu device_name; display only
    raw: Mapping[str, object] | None = field(default=None, compare=False)
    """The intervals.icu object as delivered; None for rows stored before raw was kept."""


def is_cycling(activity_type: str | None) -> bool:
    """True iff the intervals.icu type is in CYCLING_TYPES."""
    return activity_type in CYCLING_TYPES


def daily_cycling_tss(activities: Iterable[CyclingActivity]) -> dict[date, float]:
    """Sum of training_load per local date (start_date_local.date()). None counts as 0."""
    totals: dict[date, float] = {}
    for a in activities:
        day = a.start_date_local.date()
        totals[day] = totals.get(day, 0.0) + float(a.training_load or 0)
    return totals
