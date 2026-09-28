"""CTL / ATL / TSB: the single owner of the fitness/fatigue math.

Recurrence, per day t (day t's own load is included, missing days carry load 0):

    x_t = x_{t-1} + (load_t - x_{t-1}) * k(tau)

    k(tau) = 1 - exp(-1 / tau)     Decay.EXPONENTIAL  (the default; what intervals.icu uses:
                                                       w = exp(-1/days); x = x*w + load*(1-w))
    k(tau) = 1 / tau               Decay.INVERSE_TAU  (TrainingPeaks/Coggan; the alternative)

CTL uses tau = CTL_TAU_DAYS (42), ATL uses tau = ATL_TAU_DAYS (7), TSB = CTL - ATL of the same
day. No seeding in production: CTL = ATL = 0 going into SERIES_START.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Final


class Decay(Enum):
    INVERSE_TAU = "inverse_tau"
    EXPONENTIAL = "exponential"


DECAY: Final = Decay.EXPONENTIAL
"""THE switch between the two smoothing factors. Changing it recomputes all history.
EXPONENTIAL so cycling-only CTL matches intervals.icu (user decision, 2026-09-28)."""

CTL_TAU_DAYS: Final = 42
ATL_TAU_DAYS: Final = 7


@dataclass(frozen=True, slots=True)
class LoadState:
    ctl: float
    atl: float
    tsb: float


ZERO: Final = LoadState(ctl=0.0, atl=0.0, tsb=0.0)


def smoothing_factor(tau_days: float, decay: Decay = DECAY) -> float:
    """k(tau) per the module docstring."""
    if tau_days <= 0:
        raise ValueError(f"tau must be positive, got {tau_days}")
    if decay is Decay.INVERSE_TAU:
        return 1.0 / tau_days
    return 1.0 - math.exp(-1.0 / tau_days)


def ctl_atl(
    daily_loads: Sequence[float],
    *,
    decay: Decay = DECAY,
    initial: LoadState = ZERO,
) -> list[LoadState]:
    """One LoadState per input day, in order.

    ``daily_loads`` is dense (one value per consecutive day, gaps already filled with 0).
    ``initial`` is the state going into the first day; only the live parity test against
    intervals.icu passes a non-zero value (seeded from intervals.icu's ctl/atl the day before).
    """
    k_ctl = smoothing_factor(CTL_TAU_DAYS, decay)
    k_atl = smoothing_factor(ATL_TAU_DAYS, decay)
    ctl, atl = initial.ctl, initial.atl
    states: list[LoadState] = []
    for load in daily_loads:
        ctl += (load - ctl) * k_ctl
        atl += (load - atl) * k_atl
        states.append(LoadState(ctl=ctl, atl=atl, tsb=ctl - atl))
    return states
