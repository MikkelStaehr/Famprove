"""Contract: the ride_metrics and cycling_weeks rows Python writes are the web parser's fixtures
(CLAUDE.md). web/tests/fixtures/ride_metrics.json and cycling_weeks.json are the real
producer's output (domain.ride_analysis + db.ride_metrics) on synthetic rides; the web tests
parse every row. When the producer changes, regenerate them:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_ride_analysis.py
Edge cases kept in them: every exclusion reason, a ride without a power meter, a missing
distance, a VirtualRide, EF points with a trend, line breaks, a year-ago eFTP comparison,
and weeks without rides.
"""

import json
import os
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from training_load.db.ride_metrics import (
    CyclingWeekRow,
    RideMetricsRow,
    to_row,
    week_row,
)
from training_load.domain.ride_analysis import Intensity, RideFacts, analyse_rides, weekly_totals

FIXTURES = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures"
RUN_AT = datetime(2026, 10, 1, 3, 0, tzinfo=UTC)
START = date(2026, 4, 6)  # a Monday

BASE = RideFacts(
    activity_id="i100",
    day=START,
    type="Ride",
    has_raw=True,
    moving_s=5400,
    distance_m=45_000.0,
    load=80,
    np_w=175,
    avg_hr=148,
    device_watts=True,
    ftp_w=250,
    if_set=0.70,
    rolling_ftp_w=195,
)


def producer_rows() -> tuple[list[RideMetricsRow], list[CyclingWeekRow]]:
    def r(n: int, days: int, **changes: object) -> RideFacts:
        day = START + timedelta(days=days)
        return replace(BASE, activity_id=f"i{100 + n}", day=day, **changes)  # type: ignore[arg-type]

    rides = [
        r(9, -370, rolling_ftp_w=233),  # a year earlier: r(0)'s comparison point
        r(0, 0),  # EF point after a break; has a year-ago eFTP
        r(1, 3, np_w=210, if_set=0.84, avg_hr=160, load=95),  # eFTP point, not endurance
        r(2, 5, moving_s=42, distance_m=200.0, np_w=36, load=0),  # too_short
        r(3, 8, np_w=31, if_set=0.12, load=2),  # power_outlier
        r(4, 10, avg_hr=70),  # hr_outlier: eFTP yes, EF no
        r(5, 12, np_w=None, device_watts=None, if_set=0.69, distance_m=None),  # HR only
        r(6, 14, type="VirtualRide", np_w=170, avg_hr=150, distance_m=None, if_set=0.68),
        r(7, 16, has_raw=False, avg_hr=None, device_watts=None, rolling_ftp_w=None),  # no_raw
        r(8, 45, np_w=165, avg_hr=140, if_set=0.66, rolling_ftp_w=190),  # after a break
    ]
    metrics = analyse_rides(rides, basis=Intensity.SET_FTP)
    weeks = weekly_totals(metrics, first=START, last=START + timedelta(days=48))
    return (
        [to_row(m, RUN_AT) for m in metrics],
        [week_row(w, RUN_AT) for w in weeks],
    )


def _check(name: str, rows: object) -> None:
    path = FIXTURES / name
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8", newline="\n")
    assert json.loads(path.read_text(encoding="utf-8")) == rows, (
        f"web/tests/fixtures/{name} is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_ride_analysis.py"
    )


def test_the_web_fixtures_are_pythons_current_output() -> None:
    rides, weeks = producer_rows()
    _check("ride_metrics.json", json.loads(json.dumps(rides)))  # as PostgREST returns JSON
    _check("cycling_weeks.json", json.loads(json.dumps(weeks)))


def test_the_fixtures_keep_their_edge_cases() -> None:
    rides, weeks = producer_rows()
    assert {r["exclusion"] for r in rides} == {
        None,
        "no_raw",
        "too_short",
        "power_outlier",
        "hr_outlier",
    }
    assert any(r["device_watts"] is None and r["np_w"] is None for r in rides)
    assert any(r["distance_m"] is None for r in rides)
    assert any(r["type"] == "VirtualRide" for r in rides)
    assert sum(r["ef_ok"] for r in rides) >= 3 and sum(r["ef_gap_before"] for r in rides) == 3
    assert any(r["eftp_ok"] and not r["ef_ok"] for r in rides)
    assert any(r["eftp_delta_w"] == 195 - 233 for r in rides)
    assert any(r["eftp_ok"] and r["eftp_delta_w"] is None for r in rides)
    assert any(w["rides"] == 0 for w in weeks) and any(w["excluded"] > 0 for w in weeks)
