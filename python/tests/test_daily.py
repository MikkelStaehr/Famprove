"""domain.daily + domain.cycling + domain.dates: dense series assembly."""

from datetime import UTC, date, datetime

import pytest

from training_load.domain.cycling import CyclingActivity, daily_cycling_tss, is_cycling
from training_load.domain.daily import build_daily_load
from training_load.domain.dates import date_range, today_local
from training_load.domain.load import ctl_atl


def ride(start: str, load: int | None, activity_id: str = "i1") -> CyclingActivity:
    return CyclingActivity(
        id=activity_id,
        start_date_local=datetime.fromisoformat(start),
        type="VirtualRide",
        name=None,
        training_load=load,
        weighted_avg_watts=None,
        intensity_pct=None,
        ftp=None,
        moving_time_s=None,
        elapsed_time_s=None,
        power_load=None,
        hr_load=None,
    )


def test_one_row_per_day_with_gaps_as_zero_load() -> None:
    days = build_daily_load(
        {date(2026, 1, 2): 90.0},
        {date(2026, 1, 4): 20.0},
        start=date(2026, 1, 1),
        end=date(2026, 1, 5),
    )
    assert [d.date for d in days] == date_range(date(2026, 1, 1), date(2026, 1, 5))
    assert [d.total_tss for d in days] == [0.0, 90.0, 0.0, 20.0, 0.0]
    assert [(d.cycling_tss, d.strength_tss) for d in days][1:4] == [(90, 0), (0, 0), (0, 20)]


def test_ctl_starts_from_zero_and_matches_load_math() -> None:
    days = build_daily_load(
        {date(2026, 1, 1): 100.0}, {}, start=date(2026, 1, 1), end=date(2026, 1, 3)
    )
    expected = ctl_atl([100.0, 0.0, 0.0])
    assert [(d.ctl, d.atl, d.tsb) for d in days] == [(e.ctl, e.atl, e.tsb) for e in expected]


def test_loads_outside_range_are_ignored() -> None:
    days = build_daily_load(
        {date(2025, 12, 31): 500.0, date(2026, 1, 3): 500.0},
        {},
        start=date(2026, 1, 1),
        end=date(2026, 1, 2),
    )
    assert sum(d.total_tss for d in days) == 0.0


def test_is_cycling_only_ride_and_virtualride() -> None:
    assert is_cycling("Ride") and is_cycling("VirtualRide")
    assert not any(is_cycling(t) for t in ("WeightTraining", "Run", "GravelRide", None))


def test_daily_cycling_tss_buckets_by_local_date_and_null_is_zero() -> None:
    rides = [
        ride("2026-02-05T18:00:00", 80, "i1"),
        ride("2026-02-05T23:30:00", 20, "i2"),
        ride("2026-02-06T00:10:00", None, "i3"),
    ]
    assert daily_cycling_tss(rides) == {date(2026, 2, 5): 100.0, date(2026, 2, 6): 0.0}


@pytest.mark.parametrize(
    ("utc_now", "local_day"),
    [
        (datetime(2026, 6, 30, 22, 30, tzinfo=UTC), date(2026, 7, 1)),  # CEST, UTC+2
        (datetime(2026, 1, 15, 22, 30, tzinfo=UTC), date(2026, 1, 15)),  # CET, UTC+1
        (datetime(2026, 1, 15, 23, 30, tzinfo=UTC), date(2026, 1, 16)),
    ],
)
def test_today_local_uses_copenhagen(utc_now: datetime, local_day: date) -> None:
    assert today_local(utc_now) == local_day
