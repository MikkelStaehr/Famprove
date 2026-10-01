"""domain.ride_analysis (exclusions, eFTP/EF points and lines, weekly totals) and the raw
narrowing in sources.intervals.ride_facts. Synthetic values only."""

from collections import Counter
from dataclasses import replace
from datetime import date, timedelta

import pytest

from conftest import InMemoryPostgrest, raw_ride
from training_load.db.activities import all_activities, upsert_activities
from training_load.domain.ride_analysis import (
    Exclusion,
    Intensity,
    RideFacts,
    analyse_rides,
    classify,
    weekly_totals,
)
from training_load.sources.intervals import parse_activities, ride_facts

DAY = date(2026, 5, 4)  # a Monday

RIDE = RideFacts(
    activity_id="i1",
    day=DAY,
    type="Ride",
    has_raw=True,
    moving_s=3600,
    distance_m=30_000.0,
    load=60,
    np_w=180,
    avg_hr=150,
    device_watts=True,
    ftp_w=250,
    if_set=0.72,
    rolling_ftp_w=200,
)
HR_ONLY = replace(RIDE, np_w=None, device_watts=None, if_set=0.70)


def ride(n: int, day: date, **changes: object) -> RideFacts:
    return replace(RIDE, activity_id=f"i{n}", day=day, **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({}, None),
        ({"has_raw": False}, "no_raw"),
        ({"moving_s": 299}, "too_short"),
        ({"moving_s": None}, "too_short"),
        ({"distance_m": 999.0}, "too_short"),
        ({"distance_m": None}, None),  # a missing distance never excludes
        ({"moving_s": 200, "np_w": 10}, "too_short"),  # first match wins
        ({"np_w": 49}, "power_outlier"),
        ({"np_w": 49, "moving_s": 1799}, None),  # outlier checks need a ride over 30 min
        ({"if_set": 1.16}, "power_outlier"),
        ({"rolling_ftp_w": 99}, "power_outlier"),
        ({"rolling_ftp_w": 501}, "power_outlier"),
        ({"avg_hr": 79}, "hr_outlier"),
        ({"avg_hr": 201}, "hr_outlier"),
        ({"np_w": 31, "device_watts": False}, None),  # estimated power is not a power ride
        ({"np_w": 31, "device_watts": None}, None),
        (
            {"np_w": None, "device_watts": None, "rolling_ftp_w": 99},
            None,
        ),  # eFTP bounds: power only
    ],
)
def test_classify(changes: dict[str, object], expected: Exclusion | None) -> None:
    assert classify(replace(RIDE, **changes)) == expected  # type: ignore[arg-type]


def test_a_ride_without_a_power_meter_is_never_a_power_point() -> None:
    [m] = analyse_rides([HR_ONLY], basis=Intensity.SET_FTP)
    assert (m.exclusion, m.eftp_ok, m.ef, m.ef_ok, m.if_eftp) == (None, False, None, False, None)


def test_hr_outlier_stays_on_eftp_but_leaves_ef() -> None:
    [m] = analyse_rides([replace(RIDE, avg_hr=70)], basis=Intensity.SET_FTP)
    assert (m.exclusion, m.eftp_ok, m.ef_ok, m.ef_trend) == ("hr_outlier", True, False, None)


def test_power_outlier_leaves_both_lines() -> None:
    [m] = analyse_rides([replace(RIDE, np_w=31)], basis=Intensity.SET_FTP)
    assert (m.exclusion, m.eftp_ok, m.ef_ok) == ("power_outlier", False, False)


@pytest.mark.parametrize(
    ("basis", "np_w", "ef_ok"),
    [
        (Intensity.SET_FTP, 180, True),  # if_set 0.72
        (Intensity.ROLLING_EFTP, 180, False),  # 180 / 200 = 0.90
        (Intensity.ROLLING_EFTP, 148, True),  # 0.74
        (Intensity.ROLLING_EFTP, 150, False),  # 0.75 is not below 0.75
    ],
)
def test_endurance_basis(basis: Intensity, np_w: int, ef_ok: bool) -> None:
    [m] = analyse_rides([replace(RIDE, np_w=np_w)], basis=basis)
    assert m.ef_ok is ef_ok
    assert m.if_eftp == pytest.approx(np_w / 200)
    assert m.ef == pytest.approx(np_w / 150)


def test_ef_needs_30_minutes_and_hr() -> None:
    short, no_hr = analyse_rides(
        [ride(1, DAY, moving_s=1799), ride(2, DAY, avg_hr=None)], basis=Intensity.SET_FTP
    )
    assert (short.eftp_ok, short.ef_ok) == (True, False)
    assert (no_hr.eftp_ok, no_hr.ef, no_hr.ef_ok) == (True, None, False)


def test_ef_trend_is_the_28_day_median() -> None:
    rides = [
        ride(1, DAY, np_w=150),  # EF 1.0
        ride(2, DAY + timedelta(days=9), np_w=180),  # EF 1.2
        ride(3, DAY + timedelta(days=29), np_w=210, if_set=0.74),  # EF 1.4; window from day 2
    ]
    trends = [m.ef_trend for m in analyse_rides(rides, basis=Intensity.SET_FTP)]
    assert trends == pytest.approx([1.0, 1.1, 1.3])


def test_lines_break_after_21_days_without_a_point() -> None:
    rides = [
        ride(1, DAY),
        ride(2, DAY + timedelta(days=21)),  # exactly 21 days: the line continues
        ride(3, DAY + timedelta(days=43)),  # 22 days: break
        ride(4, DAY + timedelta(days=43)),  # same day as the break: continues
        replace(HR_ONLY, activity_id="i5", day=DAY + timedelta(days=80)),  # no point, no gap
        ride(6, DAY + timedelta(days=81), avg_hr=None),  # eFTP point, no EF point
    ]
    out = analyse_rides(rides, basis=Intensity.SET_FTP)
    assert [m.eftp_gap_before for m in out] == [True, False, True, False, False, True]
    assert [m.ef_gap_before for m in out] == [True, False, True, False, False, False]


def test_weekly_totals_have_a_row_for_every_week() -> None:
    first, last = date(2025, 1, 1), date(2025, 1, 20)  # Wed .. Mon: 4 ISO weeks
    rides = [
        ride(1, date(2025, 1, 7), moving_s=3600, load=50),
        ride(2, date(2025, 1, 9), moving_s=120, load=None),  # too short: counted, excluded
        ride(3, date(2025, 1, 27), moving_s=7200, load=99),  # after last's week: ignored
        replace(HR_ONLY, activity_id="i4", day=date(2025, 1, 20), moving_s=None),
    ]
    weeks = weekly_totals(analyse_rides(rides), first=first, last=last)
    assert [(w.week_start, w.rides, w.moving_s, w.load, w.excluded) for w in weeks] == [
        (date(2024, 12, 30), 0, 0, 0, 0),
        (date(2025, 1, 6), 2, 3720, 50, 1),
        (date(2025, 1, 13), 0, 0, 0, 0),
        (date(2025, 1, 20), 1, 0, 60, 1),  # moving_s None: too_short, adds 0 h
    ]


def test_ride_facts_reads_raw_and_counts_unreadable_fields() -> None:
    raw = {
        **raw_ride("i1", "2026-05-04T07:00:00", kind="Ride"),
        "average_heartrate": 149.6,
        "distance": 58429.44,
        "device_watts": True,
        "icu_rolling_ftp": "184",  # wrong type: null and counted, never parsed as text
    }
    [activity] = parse_activities([raw]).cycling
    assert activity.raw == raw
    unreadable: Counter[str] = Counter()
    facts = ride_facts(activity, unreadable)
    assert (facts.avg_hr, facts.distance_m, facts.device_watts) == (150, 58429.44, True)
    assert (facts.rolling_ftp_w, facts.np_w) == (None, 250)
    assert facts.if_set == pytest.approx(0.853)
    assert facts.has_raw and unreadable == Counter({"icu_rolling_ftp": 1})

    unreadable.clear()
    old = ride_facts(replace(activity, raw=None), unreadable)
    assert not old.has_raw and old.avg_hr is None and not unreadable


def test_raw_round_trips_through_activities(db: InMemoryPostgrest) -> None:
    raw = {**raw_ride("i1", "2026-05-04T07:00:00", kind="Ride"), "average_heartrate": 150}
    upsert_activities(db, parse_activities([raw]).cycling)
    [stored] = all_activities(db)
    assert stored.raw == raw


def test_year_ago_is_the_latest_eftp_point_365_to_386_days_earlier() -> None:
    rides = [
        ride(1, DAY - timedelta(days=387), rolling_ftp_w=240),  # too early
        ride(2, DAY - timedelta(days=380), rolling_ftp_w=233),
        ride(3, DAY - timedelta(days=370), rolling_ftp_w=231),  # latest in the window
        ride(4, DAY - timedelta(days=364), rolling_ftp_w=229),  # too late
        ride(5, DAY, rolling_ftp_w=184),
        replace(HR_ONLY, activity_id="i6", day=DAY),  # no eFTP point: no comparison
    ]
    out = {m.facts.activity_id: m for m in analyse_rides(rides)}
    assert out["i5"].eftp_year_ago == (DAY - timedelta(days=370), 231)
    assert out["i6"].eftp_year_ago is None and out["i1"].eftp_year_ago is None
