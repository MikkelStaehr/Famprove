"""Assemble the dense daily series written to public.daily_load."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from training_load.domain.dates import date_range
from training_load.domain.load import DECAY, Decay, ctl_atl


@dataclass(frozen=True, slots=True)
class DailyLoad:
    """Mirrors a public.daily_load row."""

    date: date
    cycling_tss: float
    strength_tss: float
    total_tss: float
    ctl: float
    atl: float
    tsb: float


def build_daily_load(
    cycling_tss: Mapping[date, float],
    strength_tss: Mapping[date, float],
    *,
    start: date,
    end: date,
    decay: Decay = DECAY,
) -> list[DailyLoad]:
    """One row per date in [start, end] (inclusive), gaps filled with 0 load.

    total_tss = cycling + strength; CTL/ATL/TSB via ``load.ctl_atl`` starting from ZERO.
    Loads dated outside [start, end] are ignored (the caller logs how many).
    """
    days = date_range(start, end)
    cycling = [cycling_tss.get(d, 0.0) for d in days]
    strength = [strength_tss.get(d, 0.0) for d in days]
    totals = [c + s for c, s in zip(cycling, strength, strict=True)]
    states = ctl_atl(totals, decay=decay)
    return [
        DailyLoad(
            date=d, cycling_tss=c, strength_tss=s, total_tss=t, ctl=st.ctl, atl=st.atl, tsb=st.tsb
        )
        for d, c, s, t, st in zip(days, cycling, strength, totals, states, strict=True)
    ]
