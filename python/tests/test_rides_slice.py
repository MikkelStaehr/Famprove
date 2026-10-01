"""The ride analysis against an anonymised slice of real intervals.icu rides
(fixtures/rides_slice.json: about 21 months, dates shifted, no times of day).

Synthetic rides only hold what we expected; the real ones hold 3-second recordings without
distance, rides without a power meter, a dead power meter (NP 31 W over 97 min) and a
5-month break. Refresh the slice when the source changes (a new season, a new device):
re-export the fields named in its note, anonymised the same way.
"""

import json
from collections import Counter
from pathlib import Path

import pytest

from training_load.domain.ride_analysis import Intensity, RideFacts, analyse_rides
from training_load.sources.intervals import parse_activities, ride_facts

SLICE = Path(__file__).parent / "fixtures" / "rides_slice.json"


@pytest.fixture(scope="module")
def facts() -> list[RideFacts]:
    doc = json.loads(SLICE.read_text(encoding="utf-8"))
    unreadable: Counter[str] = Counter()
    rides = [ride_facts(a, unreadable) for a in parse_activities(doc["rides"]).cycling]
    assert not unreadable, "every raw field of the real rides narrows"
    return rides


def test_real_rides_are_classified_as_measured(facts: list[RideFacts]) -> None:
    metrics = analyse_rides(facts, basis=Intensity.SET_FTP)
    assert len(metrics) == 60
    assert Counter(m.exclusion for m in metrics) == {None: 47, "too_short": 12, "power_outlier": 1}
    [dead_meter] = [m for m in metrics if m.exclusion == "power_outlier"]
    assert (dead_meter.facts.np_w, dead_meter.facts.moving_s) == (31, 5836)
    assert all(m.facts.moving_s is not None for m in metrics if m.exclusion is None)


def test_real_rides_without_a_power_meter_are_never_power_points(facts: list[RideFacts]) -> None:
    metrics = analyse_rides(facts)
    assert sum(m.eftp_ok for m in metrics) == 40
    assert all(m.facts.device_watts is True for m in metrics if m.eftp_ok)
    assert all(m.ef is None for m in metrics if m.facts.device_watts is not True)


def test_the_endurance_basis_decides_whether_ef_has_points(facts: list[RideFacts]) -> None:
    # Measured 2026-10-01: the rolling eFTP is a floor (few maximal efforts), so on it no ride
    # of 30 min or more is below IF 0.75; on intervals.icu's IF (set FTP 250 W) 11 are.
    assert sum(m.ef_ok for m in analyse_rides(facts, basis=Intensity.ROLLING_EFTP)) == 0
    assert sum(m.ef_ok for m in analyse_rides(facts, basis=Intensity.SET_FTP)) == 11
    assert sum(m.ef_ok for m in analyse_rides(facts)) == 11  # the default (ENDURANCE)


def test_the_real_break_splits_the_eftp_line_and_a_year_ago_exists(
    facts: list[RideFacts],
) -> None:
    metrics = analyse_rides(facts)
    assert sum(m.eftp_gap_before for m in metrics) == 4
    latest = [m for m in metrics if m.eftp_ok][-1]
    assert latest.facts.rolling_ftp_w == 184
    assert latest.eftp_year_ago is not None and latest.eftp_year_ago[1] == 233
