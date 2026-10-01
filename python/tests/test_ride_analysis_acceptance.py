"""Tester (task d, part A): the ride-analysis acceptance criteria at their boundaries, the
"first match wins" order, messy raw values, the RideDataError threshold and cycling_weeks
against daily_load on the real-ride slice. Synthetic values plus fixtures/rides_slice.json."""

import json
from collections import Counter
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from conftest import InMemoryPostgrest, raw_ride
from training_load.cli import compute
from training_load.db.activities import upsert_activities
from training_load.db.ride_metrics import to_row
from training_load.domain.cycling import CyclingActivity
from training_load.domain.ride_analysis import (
    Exclusion,
    Intensity,
    RideFacts,
    analyse_rides,
    classify,
    weekly_totals,
)
from training_load.domain.strength import iso_week_start
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
AT = datetime(2026, 9, 30, 3, 0, tzinfo=UTC)


def ride(n: int, day: date, **changes: object) -> RideFacts:
    return replace(RIDE, activity_id=f"i{n}", day=day, **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "changes",
    [
        {"moving_s": 300},  # exactly 5 min
        {"distance_m": 1000.0},  # exactly 1 km
        {"np_w": 50},
        {"if_set": 1.15},
        {"rolling_ftp_w": 100},
        {"rolling_ftp_w": 500},
        {"avg_hr": 80},
        {"avg_hr": 200},
        {"np_w": 10, "device_watts": False},  # estimated power: no power checks at all
        {"if_set": 1.5, "device_watts": None},  # HR-based IF on a ride without a meter
    ],
)
def test_classify_limits_are_inclusive(changes: dict[str, object]) -> None:
    assert classify(replace(RIDE, **changes)) is None  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"has_raw": False, "moving_s": 10, "rolling_ftp_w": 99}, "no_raw"),
        ({"moving_s": 200, "rolling_ftp_w": 99, "avg_hr": 70}, "too_short"),
        ({"distance_m": 10.0, "np_w": 49}, "too_short"),
        ({"np_w": 49, "avg_hr": 70}, "power_outlier"),
        ({"if_set": 1.2, "avg_hr": 250}, "power_outlier"),
        ({"rolling_ftp_w": 501, "avg_hr": 70}, "power_outlier"),
        ({"moving_s": 1800, "np_w": 49}, "power_outlier"),  # exactly 30 min is long
        ({"moving_s": 600, "rolling_ftp_w": 99}, "power_outlier"),  # eFTP bounds: any length
        ({"moving_s": 1799, "avg_hr": 70}, None),  # HR check needs 30 min
    ],
)
def test_first_match_wins(changes: dict[str, object], expected: Exclusion | None) -> None:
    assert classify(replace(RIDE, **changes)) == expected  # type: ignore[arg-type]


@pytest.mark.parametrize("device_watts", [False, None])
def test_estimated_power_is_never_a_power_point(device_watts: bool | None) -> None:
    [m] = analyse_rides([replace(RIDE, device_watts=device_watts)], basis=Intensity.SET_FTP)
    assert (m.exclusion, m.eftp_ok, m.if_eftp, m.ef, m.ef_ok, m.eftp_year_ago) == (
        None,
        False,
        None,
        None,
        False,
        None,
    )


def test_rides_without_a_power_meter_count_in_the_weeks() -> None:
    rides = [
        replace(HR_ONLY, activity_id="h1", day=DAY, moving_s=2700, load=40),
        replace(HR_ONLY, activity_id="h2", day=DAY + timedelta(days=2), moving_s=1200, load=15),
        ride(3, DAY + timedelta(days=3), moving_s=3600, load=60),
    ]
    metrics = analyse_rides(rides)
    assert [(m.eftp_ok, m.ef, m.ef_ok) for m in metrics[:2]] == [(False, None, False)] * 2
    [week] = weekly_totals(metrics, first=DAY, last=DAY)
    assert (week.rides, week.moving_s, week.load, week.excluded) == (3, 7500, 115, 0)


def test_ef_trend_window_is_28_days_ending_on_the_ride() -> None:
    rides = [
        ride(1, DAY, np_w=150),  # EF 1.0, 28 days before ride 4: outside
        ride(2, DAY + timedelta(days=1), np_w=180),  # EF 1.2, 27 days before ride 4: inside
        ride(3, DAY + timedelta(days=20), np_w=165),  # EF 1.1
        ride(4, DAY + timedelta(days=28), np_w=210, if_set=0.74),  # EF 1.4
    ]
    trends = [m.ef_trend for m in analyse_rides(rides, basis=Intensity.SET_FTP)]
    # ride 4: median(1.2, 1.1, 1.4) = 1.2; with ride 1 inside it would be 1.15
    assert trends == pytest.approx([1.0, 1.1, 1.1, 1.2])


def test_year_ago_window_is_inclusive_and_delta_is_rolling_minus_year_ago() -> None:
    for days in (365, 386):
        out = analyse_rides(
            [
                ride(1, DAY - timedelta(days=days), rolling_ftp_w=233),
                ride(2, DAY, rolling_ftp_w=184),
            ]
        )
        assert out[1].eftp_year_ago == (DAY - timedelta(days=days), 233)
        row = to_row(out[1], AT)
        assert (row["eftp_year_ago_date"], row["eftp_year_ago_w"], row["eftp_delta_w"]) == (
            (DAY - timedelta(days=days)).isoformat(),
            233,
            184 - 233,
        )
        first = to_row(out[0], AT)
        assert (first["eftp_year_ago_w"], first["eftp_delta_w"]) == (None, None)


def test_hr_outlier_carries_the_eftp_line_but_not_the_ef_line() -> None:
    rides = [
        ride(1, DAY),
        ride(2, DAY + timedelta(days=15), avg_hr=210),  # hr_outlier: eFTP point only
        ride(3, DAY + timedelta(days=30)),  # 15 days after ride 2, 30 after ride 1
    ]
    out = analyse_rides(rides, basis=Intensity.SET_FTP)
    assert [m.eftp_gap_before for m in out] == [True, False, False]
    assert [m.ef_gap_before for m in out] == [True, False, True]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("distance", "58429,44"),  # comma decimal as text
        ("distance", "58429.44"),  # dot decimal as text
        ("average_heartrate", "149,6"),
        ("average_heartrate", "150"),
        ("icu_rolling_ftp", "184,0"),
        ("device_watts", "true"),
        ("device_watts", 1),
    ],
)
def test_text_values_in_raw_become_null_and_are_counted(field: str, value: object) -> None:
    raw = {**raw_ride("i1", "2026-05-04T07:00:00", kind="Ride"), field: value}
    [activity] = parse_activities([raw]).cycling
    unreadable: Counter[str] = Counter()
    facts = ride_facts(activity, unreadable)
    by_field = {
        "distance": facts.distance_m,
        "average_heartrate": facts.avg_hr,
        "icu_rolling_ftp": facts.rolling_ftp_w,
        "device_watts": facts.device_watts,
    }
    assert by_field[field] is None
    assert unreadable == Counter({field: 1})


def _rides(n: int, *, without_raw: int) -> list[CyclingActivity]:
    parsed = parse_activities(
        [
            {**raw_ride(f"i{i}", f"2026-03-0{i + 1}T10:00:00", kind="Ride"), "device_watts": True}
            for i in range(n)
        ]
    ).cycling
    return [replace(a, raw=None) if i < without_raw else a for i, a in enumerate(parsed)]


def test_exactly_20_percent_without_raw_does_not_fail(db: InMemoryPostgrest) -> None:
    upsert_activities(db, _rides(5, without_raw=1))
    summary = compute.run(db, strength_k=0.02, today=date(2026, 3, 15), computed_at=AT)
    assert summary.rides_excluded == {"no_raw": 1}


def test_more_than_20_percent_without_raw_fails_after_writing(db: InMemoryPostgrest) -> None:
    upsert_activities(db, _rides(5, without_raw=2))
    with pytest.raises(compute.RideDataError, match="2 of 5 rides have no raw"):
        compute.run(db, strength_k=0.02, today=date(2026, 3, 15), computed_at=AT)
    assert len(db.tables["daily_load"]) == 74 and len(db.tables["ride_metrics"]) == 5


def test_cycling_weeks_match_daily_load_on_the_real_slice(db: InMemoryPostgrest) -> None:
    doc = json.loads(
        (Path(__file__).parent / "fixtures" / "rides_slice.json").read_text(encoding="utf-8")
    )
    upsert_activities(db, parse_activities(doc["rides"]).cycling)
    today = date(2026, 9, 30)
    compute.run(db, strength_k=0.02, today=today, computed_at=AT)

    weeks = {str(w["week_start"]): w for w in db.tables["cycling_weeks"]}
    expected = []
    week = iso_week_start(date(2025, 1, 1))
    while week <= iso_week_start(today):
        expected.append(week.isoformat())
        week += timedelta(days=7)
    assert sorted(weeks) == expected
    assert sum(1 for w in weeks.values() if w["rides"] == 0) > 0

    daily: dict[str, float] = {}
    for r in db.tables["daily_load"]:
        start = iso_week_start(date.fromisoformat(str(r["date"]))).isoformat()
        daily[start] = daily.get(start, 0.0) + float(str(r["cycling_tss"]))
    in_2026 = [w for w in expected if w >= "2026-01-05"]
    assert in_2026 and all(weeks[w]["load"] == daily[w] for w in in_2026)
    assert sum(float(str(weeks[w]["load"])) for w in in_2026) > 0
