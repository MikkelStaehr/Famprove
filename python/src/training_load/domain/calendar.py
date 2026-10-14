"""The intervals.icu calendar as the prognose sees it (answers round, user 2026-10-14): which
events are planned rides. Stdlib only, like the rest of domain/."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from training_load.domain.projection import HORIZON_DAYS
from training_load.domain.strength import iso_week_start

PLANNED_RIDE_CATEGORY: Final = "WORKOUT"
PLANNED_RIDE_TYPES: Final = frozenset({"Ride", "VirtualRide"})


@dataclass(frozen=True, slots=True)
class PlannedEvent:
    """One intervals.icu calendar event, stored raw in public.planned_events."""

    id: int
    date: date  # the local date of start_date_local
    category: str
    type: str | None
    name: str | None
    load: float | None  # icu_training_load; None = missing (absent, not a finite number, or <= 0)
    raw: Mapping[str, object]

    @property
    def is_planned_ride(self) -> bool:
        return self.category == PLANNED_RIDE_CATEGORY and self.type in PLANNED_RIDE_TYPES


def events_window(today: date) -> tuple[date, date]:
    """This ISO week's Monday .. the Sunday of the week holding today + HORIZON_DAYS: every week
    the prognose touches, whole (the week rule needs all of a week's planned rides). The window
    collect-events mirrors and compute reads."""
    last = iso_week_start(today + timedelta(days=HORIZON_DAYS)) + timedelta(days=6)
    return iso_week_start(today), last
