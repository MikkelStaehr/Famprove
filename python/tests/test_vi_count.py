"""Tester's re-check of fix 49c5bb4: compute counts a ride as an implausible VI when NP and
average power are both delivered but there is no VI (ratio out of bounds, or an average of 0);
a ride missing either is not counted."""

import logging
from datetime import UTC, datetime

import pytest

from conftest import FIXED_TODAY, InMemoryPostgrest, raw_ride
from training_load.cli import compute
from training_load.db.activities import upsert_activities
from training_load.sources.intervals import parse_activities


def ride(activity_id: str, day: str, **power: object) -> dict[str, object]:
    return {
        **raw_ride(activity_id, f"{day}T09:00:00", kind="Ride"),  # NP 250
        "average_heartrate": 150,
        "distance": 40_000.0,
        "device_watts": True,
        "icu_rolling_ftp": 200,
        **power,
    }


def test_average_power_0_counts_as_implausible_and_missing_power_does_not(
    db: InMemoryPostgrest, caplog: pytest.LogCaptureFixture
) -> None:
    rides = [
        ride("i1", "2026-03-01", icu_average_watts=0),  # delivered, no VI: counted
        ride("i2", "2026-03-02", icu_average_watts=100),  # 2.5: counted
        ride("i3", "2026-03-03", icu_average_watts=200),  # 1.25: a VI
        ride("i4", "2026-03-04"),  # average missing: not counted
        ride("i5", "2026-03-05", icu_average_watts=None),  # average null: not counted
        ride("i6", "2026-03-06", icu_average_watts=200, icu_weighted_avg_watts=None),  # no NP
        ride("i7", "2026-03-07", icu_average_watts="200,0"),  # text: unreadable, not implausible
    ]
    upsert_activities(db, parse_activities(rides).cycling)
    with caplog.at_level(logging.INFO):
        compute.run(
            db, strength_k=0.02, today=FIXED_TODAY, computed_at=datetime(2026, 3, 15, 3, tzinfo=UTC)
        )
    vi = {r["activity_id"]: r["vi"] for r in db.tables["ride_metrics"]}
    assert vi == {
        "i1": None,
        "i2": None,
        "i3": 1.25,
        "i4": None,
        "i5": None,
        "i6": None,
        "i7": None,
    }
    assert "2 rides have an implausible VI" in caplog.text
    assert "VI on 1 of 7 rides" in caplog.text
    assert "icu_average_watts" in caplog.text  # the text value is logged as unreadable
