"""Tester's edge cases for slice ride-vi (C1, C2) and the A3 boundary: rounding at the 1.15
warning threshold, raw ratios just outside [1.0, 2.0], messy raw average power (text, comma
decimals), the compute log count of implausible VIs, and the Z2 word rule."""

import logging
from collections import Counter
from datetime import UTC, date, datetime

import pytest

from conftest import (
    FIXED_TODAY,
    InMemoryPostgrest,
    raw_ride,
)
from training_load.cli import compute
from training_load.db.activities import upsert_activities
from training_load.domain.ride_analysis import RideFacts, analyse_rides, is_z2, variability_index
from training_load.sources.intervals import parse_activities, ride_facts

DAY = date(2026, 10, 11)


def facts(np_w: int | None, avg_w: int | None, name: str | None = "Z2 Base") -> RideFacts:
    return RideFacts(
        activity_id="i1",
        day=DAY,
        type="Ride",
        has_raw=True,
        moving_s=3600,
        distance_m=30_000.0,
        load=50,
        np_w=np_w,
        avg_hr=140,
        device_watts=True,
        ftp_w=250,
        if_set=0.7,
        rolling_ftp_w=240,
        avg_w=avg_w,
        name=name,
    )


@pytest.mark.parametrize(
    ("np_w", "avg_w", "vi", "warning"),
    [
        (173, 150, 1.15, False),  # raw 1.1533 rounds to 1.15: not above 1.15
        (174, 150, 1.16, True),  # raw 1.16: above
        (115, 100, 1.15, False),  # exactly 1.15: not above
        (401, 200, None, None),  # raw 2.005 is outside [1.0, 2.0] even though it rounds to 2.0
        (200, 200, 1.0, False),  # lower bound inclusive
        (400, 200, 2.0, True),  # upper bound inclusive
    ],
)
def test_vi_rounds_to_2_dp_and_warns_only_above_1_15_on_a_z2_ride(
    np_w: int, avg_w: int, vi: float | None, warning: bool | None
) -> None:
    assert variability_index(facts(np_w, avg_w)) == vi
    [m] = analyse_rides([facts(np_w, avg_w)])
    assert (m.vi, m.vi_warning) == (vi, warning)


def test_no_vi_means_no_warning_even_on_a_planned_z2_day() -> None:
    [m] = analyse_rides([facts(None, 150, name="Morning Ride")], z2_days={DAY})
    assert (m.vi, m.vi_warning) == (None, None)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Z2-intervaller", True),
        ("Tempo/Z2", True),
        ("(z2)", True),
        ("Z2Z3 mix", False),
        ("Z20 test", False),
        ("FTPZ2", False),
        ("", False),
    ],
)
def test_z2_is_matched_as_a_word_only(name: str, expected: bool) -> None:
    assert is_z2(name) is expected


@pytest.mark.parametrize("value", ["180", "180,5", "180.5", " 180 ", ""])
def test_average_power_as_text_is_counted_unreadable_and_gives_no_vi(value: str) -> None:
    raw = {**raw_ride("i1", "2026-10-11T08:00:00", kind="Ride"), "icu_average_watts": value}
    [activity] = parse_activities([raw]).cycling
    unreadable: Counter[str] = Counter()
    f = ride_facts(activity, unreadable)
    assert f.avg_w is None
    assert unreadable == Counter({"icu_average_watts": 1})
    assert variability_index(f) is None


def test_average_power_missing_vs_blank_vs_zero() -> None:
    base = raw_ride("i1", "2026-10-11T08:00:00", kind="Ride")
    missing = {k: v for k, v in base.items() if k != "icu_average_watts"}
    for raw in (missing, {**base, "icu_average_watts": None}, {**base, "icu_average_watts": 0}):
        [activity] = parse_activities([raw]).cycling
        unreadable: Counter[str] = Counter()
        f = ride_facts(activity, unreadable)
        assert variability_index(f) is None
        assert unreadable == Counter()  # missing / null / 0 are not unreadable


def test_compute_stores_vi_and_counts_implausible_ratios_in_the_log(
    db: InMemoryPostgrest, caplog: pytest.LogCaptureFixture
) -> None:
    def ride(activity_id: str, start: str, avg_w: object, name: str = "Zwift") -> dict[str, object]:
        return {
            **raw_ride(activity_id, start, kind="Ride"),  # NP (icu_weighted_avg_watts) = 250
            "name": name,
            "average_heartrate": 150,
            "distance": 40_000.0,
            "device_watts": True,
            "icu_rolling_ftp": 200,
            "icu_average_watts": avg_w,
        }

    rides = [
        ride("i1", "2026-03-01T09:00:00", 200, name="Z2 Base"),  # 1.25 on Z2: warning
        ride("i2", "2026-03-02T09:00:00", 200),  # 1.25, not Z2
        ride("i3", "2026-03-03T09:00:00", 100),  # 2.5: implausible
        ride("i4", "2026-03-04T09:00:00", 260),  # 0.96: implausible
        ride("i5", "2026-03-05T09:00:00", None),  # missing: no VI, not counted
        ride("i6", "2026-03-06T09:00:00", 200),  # 1.25 on a planned Z2 day: warning
    ]
    upsert_activities(db, parse_activities(rides).cycling)
    db.tables["planned_sessions"] = [
        {"date": "2026-03-06", "name": "Z2 lang tur", "steps": None, "notes": None}
    ]
    with caplog.at_level(logging.INFO):
        compute.run(
            db,
            strength_k=0.02,
            today=FIXED_TODAY,
            computed_at=datetime(2026, 3, 15, 3, 0, tzinfo=UTC),
        )
    got = {r["activity_id"]: (r["vi"], r["vi_warning"]) for r in db.tables["ride_metrics"]}
    assert got == {
        "i1": (1.25, True),
        "i2": (1.25, False),
        "i3": (None, None),
        "i4": (None, None),
        "i5": (None, None),
        "i6": (1.25, True),
    }
    assert "2 rides have an implausible VI" in caplog.text
    assert "VI on 3 of 6 rides (2 with a Z2 warning)" in caplog.text
