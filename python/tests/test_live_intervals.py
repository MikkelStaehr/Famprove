"""Live parity with intervals.icu. Marked ``live`` (deselected by default): run
``uv run pytest -m live`` with INTERVALS_API_KEY / INTERVALS_ATHLETE_ID set (``.env.local``).

intervals.icu has history before 2026, so each check seeds ``initial`` from its ctl/atl on
the day before the window. Only CTL is compared: by default intervals.icu counts strength
toward fatigue (ATL) but not fitness (CTL), so its CTL is the cycling-only CTL.
"""

import os
from datetime import timedelta

import pytest

from training_load.config import load_dotenv_file
from training_load.domain.cycling import daily_cycling_tss
from training_load.domain.dates import date_range, today_local
from training_load.domain.load import ATL_TAU_DAYS, DECAY, Decay, LoadState, ctl_atl
from training_load.http import requests_send
from training_load.sources.intervals import (
    WellnessDay,
    fetch_activities,
    fetch_wellness,
    parse_activities,
)

pytestmark = pytest.mark.live

WINDOW_DAYS = 90
CTL_TOLERANCE = 0.1  # measured with EXPONENTIAL: 0.00 (1/tau drifts ~0.2 at CTL 20)


def _credentials() -> tuple[str, str]:
    load_dotenv_file()
    key, athlete = os.environ.get("INTERVALS_API_KEY"), os.environ.get("INTERVALS_ATHLETE_ID")
    if not key or not athlete:
        pytest.skip("INTERVALS_API_KEY / INTERVALS_ATHLETE_ID not set")
    return key, athlete


@pytest.fixture(scope="module")
def window() -> tuple[list[WellnessDay], dict[str, float]]:
    key, athlete = _credentials()
    send = requests_send()
    end = today_local() - timedelta(days=1)  # today may still change
    start = end - timedelta(days=WINDOW_DAYS)
    wellness = fetch_wellness(
        send, api_key=key, athlete_id=athlete, oldest=start - timedelta(days=1), newest=end
    )
    raw = fetch_activities(send, api_key=key, athlete_id=athlete, oldest=start, newest=end)
    cycling = {
        d.isoformat(): v for d, v in daily_cycling_tss(parse_activities(raw).cycling).items()
    }
    return sorted(wellness, key=lambda w: w.date), cycling


def _seed(day: WellnessDay) -> LoadState:
    assert day.ctl is not None and day.atl is not None
    return LoadState(ctl=day.ctl, atl=day.atl, tsb=day.ctl - day.atl)


def _max_ctl_gap(wellness: list[WellnessDay], loads: list[float], decay: Decay) -> float:
    ours = ctl_atl(loads, decay=decay, initial=_seed(wellness[0]))
    return max(abs(o.ctl - (w.ctl or 0.0)) for o, w in zip(ours, wellness[1:], strict=True))


def test_ctl_math_matches_intervals_given_its_own_daily_load(
    window: tuple[list[WellnessDay], dict[str, float]],
) -> None:
    """Validates the recurrence itself: intervals.icu's ctlLoad in, its ctl out."""
    wellness, _ = window
    if any(w.ctl_load is None for w in wellness[1:]):
        pytest.skip("wellness has no ctlLoad")
    loads = [w.ctl_load or 0.0 for w in wellness[1:]]
    assert _max_ctl_gap(wellness, loads, Decay.EXPONENTIAL) < CTL_TOLERANCE


def test_cycling_only_ctl_matches_intervals_ctl(
    window: tuple[list[WellnessDay], dict[str, float]],
) -> None:
    """The user's requirement, with the production DECAY and our Ride/VirtualRide filter."""
    wellness, cycling = window
    days = [w.date for w in wellness[1:]]
    assert days == date_range(days[0], days[-1]), "wellness must be one row per day"
    loads = [cycling.get(d.isoformat(), 0.0) for d in days]
    gap = _max_ctl_gap(wellness, loads, DECAY)
    other = next(d for d in Decay if d is not DECAY)
    assert gap < CTL_TOLERANCE, (
        f"max |CTL - intervals CTL| = {gap:.2f} with {DECAY.value}; "
        f"with {other.value} it would be {_max_ctl_gap(wellness, loads, other):.2f} "
        f"(ATL tau {ATL_TAU_DAYS} not compared)"
    )
