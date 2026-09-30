"""CTL ramp and form zone: the single owner of both dashboard indicators (M2).

Pure functions on top of the series from ``domain.load.ctl_atl``. ``domain.daily`` calls them
while building ``DailyLoad``; ``db.daily_load`` stores the results as-is in
public.daily_load.ctl_ramp_7d / form_zone. The frontend only displays them.

CTL ramp
    ramp[i] = ctl[i] - ctl[i - RAMP_DAYS] for i >= RAMP_DAYS (0-based index into the dense,
    one-value-per-day series that starts at SERIES_START); None for i < RAMP_DAYS, because
    there is no earlier value (the series starts at CTL = 0, no seeding). Unit: TSS/day.

Form zone
    Input: tsb and ctl of the same day. The value compared with the bands is
        FormBasis.ABSOLUTE_TSB     x = tsb
        FormBasis.PERCENT_OF_CTL   x = 100 * tsb / ctl (0 when ctl is 0, as intervals.icu does)
    FORM_ZONES is ordered from the highest band to the lowest. x belongs to the FIRST band
    whose ``lower`` it clears: x >= lower when the band's ``lower_inclusive``, else x > lower.
    The last band has ``lower = None`` (no floor), so every x maps to exactly one zone.
    The stored label is ``FormZone.value`` (a stable lowercase key, e.g. "grey_zone"); display
    text and colour are the frontend's concern.

    Source: intervals.icu's own fitness chart (frontend constants highRisk -30, optimal -10,
    fresh 5, transition 20; classifier: x <= -30 high risk, -30 < x <= -10 optimal,
    5 <= x < 20 fresh, x >= 20 transition, else grey zone). The developer: "The zones come
    from Joe Friel and are for absolute TSB" (forum.intervals.icu/t/3623). The same numbers
    apply to % of fitness when that display option is on; percent form is 0 when CTL is 0.
    The user's intervals.icu shows absolute TSB (icu_form_as_percent = false), so FORM_BASIS
    is ABSOLUTE_TSB. This table owns the thresholds and the classification. The web never
    classifies a TSB: web/src/lib/zone-scale.ts repeats the numbers only to draw the zone
    bar, and web/tests/zone-scale.test.ts fails if the two drift.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum, StrEnum
from typing import Final

RAMP_DAYS: Final = 7
"""Look-back for ctl_ramp_7d (public.daily_load.ctl_ramp_7d)."""


class FormBasis(Enum):
    ABSOLUTE_TSB = "absolute_tsb"
    PERCENT_OF_CTL = "percent_of_ctl"


class FormZone(StrEnum):
    """Zone keys stored in public.daily_load.form_zone (plain text column, no CHECK).

    Renaming a value changes stored data on the next compute (daily_load is fully rebuilt)
    and must be mirrored in the web display map.
    """

    TRANSITION = "transition"
    FRESH = "fresh"
    GREY_ZONE = "grey_zone"
    OPTIMAL = "optimal"
    HIGH_RISK = "high_risk"


@dataclass(frozen=True, slots=True)
class ZoneBand:
    zone: FormZone
    lower: float | None
    """Lower bound in FORM_BASIS units (TSB, or percent of CTL). None = no floor (last band)."""
    lower_inclusive: bool = True
    """intervals.icu puts -30 and -10 in the LOWER zone but 5 and 20 in the HIGHER one."""


FORM_BASIS: Final[FormBasis] = FormBasis.ABSOLUTE_TSB
FORM_ZONES: Final[tuple[ZoneBand, ...]] = (
    ZoneBand(FormZone.TRANSITION, 20.0, lower_inclusive=True),
    ZoneBand(FormZone.FRESH, 5.0, lower_inclusive=True),
    ZoneBand(FormZone.GREY_ZONE, -10.0, lower_inclusive=False),
    ZoneBand(FormZone.OPTIMAL, -30.0, lower_inclusive=False),
    ZoneBand(FormZone.HIGH_RISK, None),
)
"""Invariants (asserted in tests): non-empty, lowers strictly descending, only the last band
has lower None, each FormZone member appears exactly once."""


def ctl_ramp(ctl: Sequence[float], *, days: int = RAMP_DAYS) -> list[float | None]:
    """One value per input day: ``ctl[i] - ctl[i - days]``, None for the first ``days`` days.

    ``ctl`` is the dense CTL series in date order (as returned by ``load.ctl_atl``).
    ValueError if ``days`` < 1. Values are stored as-is (no rounding).
    """
    if days < 1:
        raise ValueError(f"days must be >= 1, got {days}")
    return [ctl[i] - ctl[i - days] if i >= days else None for i in range(len(ctl))]


def form_value(tsb: float, ctl: float, basis: FormBasis = FORM_BASIS) -> float:
    """The number compared with the bands: TSB, or TSB as % of CTL (0 when CTL is 0)."""
    if basis is FormBasis.ABSOLUTE_TSB:
        return tsb
    return 0.0 if ctl == 0 else 100.0 * tsb / ctl


def form_zone(tsb: float, ctl: float, basis: FormBasis = FORM_BASIS) -> FormZone:
    """The FORM_ZONES band for this day per the module docstring (always defined)."""
    x = form_value(tsb, ctl, basis)
    for band in FORM_ZONES:
        if band.lower is None or x > band.lower or (band.lower_inclusive and x == band.lower):
            return band.zone
    raise AssertionError("unreachable: the last band has no floor")
