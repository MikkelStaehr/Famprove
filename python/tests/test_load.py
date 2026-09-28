"""domain.load: CTL/ATL/TSB math, both decay variants, hand-computed fixtures."""

import math
from collections.abc import Sequence

import pytest

from training_load.domain.load import DECAY, ZERO, Decay, LoadState, ctl_atl, smoothing_factor


def intervals_reference(loads: Sequence[float], days: int) -> list[float]:
    """intervals.icu's published code, verbatim in Python (forum.intervals.icu/t/4485/15):
    ``weight = exp(-1 / days); tot = tot * weight; tot += training_load * (1 - weight)``."""
    weight = math.exp(-1 / days)
    tot, out = 0.0, []
    for training_load in loads:
        tot = tot * weight
        tot += training_load * (1 - weight)
        out.append(tot)
    return out


def test_default_decay_is_inverse_tau() -> None:
    assert DECAY is Decay.INVERSE_TAU


def test_smoothing_factors() -> None:
    assert smoothing_factor(42, Decay.INVERSE_TAU) == 1 / 42
    assert smoothing_factor(7, Decay.INVERSE_TAU) == 1 / 7
    assert smoothing_factor(42, Decay.EXPONENTIAL) == pytest.approx(0.0235283, abs=1e-7)
    assert smoothing_factor(7, Decay.EXPONENTIAL) == pytest.approx(0.1331221, abs=1e-7)


def test_zero_loads_stay_zero() -> None:
    assert ctl_atl([0.0] * 5) == [ZERO] * 5


def test_first_day_includes_its_own_load() -> None:
    [day] = ctl_atl([100.0])
    assert day.ctl == pytest.approx(100 / 42)
    assert day.atl == pytest.approx(100 / 7)
    assert day.tsb == pytest.approx(100 / 42 - 100 / 7)


def test_hand_computed_three_days_inverse_tau() -> None:
    # Day 1: 100, day 2: rest, day 3: 50.
    ctl1, atl1 = 100 / 42, 100 / 7
    ctl2, atl2 = ctl1 * 41 / 42, atl1 * 6 / 7
    ctl3, atl3 = ctl2 + (50 - ctl2) / 42, atl2 + (50 - atl2) / 7
    days = ctl_atl([100.0, 0.0, 50.0])
    assert [d.ctl for d in days] == pytest.approx([ctl1, ctl2, ctl3])
    assert [d.atl for d in days] == pytest.approx([atl1, atl2, atl3])


def test_tsb_is_ctl_minus_atl_same_day() -> None:
    for day in ctl_atl([80.0, 0.0, 120.0, 30.0]):
        assert day.tsb == pytest.approx(day.ctl - day.atl)


def test_constant_load_converges_to_load() -> None:
    last = ctl_atl([60.0] * 2000)[-1]
    assert [last.ctl, last.atl] == pytest.approx([60.0, 60.0])


def test_exponential_matches_intervals_published_recurrence() -> None:
    loads = [0, 85, 0, 0, 110, 40, 0, 95, 0, 0, 0, 130, 60, 0] * 10
    days = ctl_atl([float(x) for x in loads], decay=Decay.EXPONENTIAL)
    assert [d.ctl for d in days] == pytest.approx(intervals_reference(loads, 42))
    assert [d.atl for d in days] == pytest.approx(intervals_reference(loads, 7))


def test_initial_state_seeds_recurrence() -> None:
    [day] = ctl_atl([0.0], initial=LoadState(ctl=42.0, atl=70.0, tsb=-28.0))
    assert [day.ctl, day.atl] == pytest.approx([41.0, 60.0])


def test_non_positive_tau_rejected() -> None:
    with pytest.raises(ValueError, match="tau"):
        smoothing_factor(0)
