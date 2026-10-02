"""Contract: the web's EF-ride count (analyse-view.efWindowRides, used to hide the EF trend under
3 rides) and Python's EF window (domain.ride_analysis.ef_window) agree on the same rows.

web/tests/fixtures/ef_window.json holds the real producer's ride_metrics rows (analyse_rides +
to_row) on synthetic rides around the window edges, plus Python's count per EF ride. When the
producer or the window changes, regenerate it:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_ef_window.py
"""

import json
import os
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from training_load.db.ride_metrics import to_row
from training_load.domain.ride_analysis import (
    EF_TREND_DAYS,
    Intensity,
    RideFacts,
    analyse_rides,
    ef_window,
)

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "ef_window.json"
RUN_AT = datetime(2026, 10, 2, 10, 0, tzinfo=UTC)
DAY0 = date(2026, 5, 1)
BASE = RideFacts(
    activity_id="i300",
    day=DAY0,
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


def producer() -> dict[str, object]:
    def r(n: int, days: int, **changes: object) -> RideFacts:
        return replace(BASE, activity_id=f"i{300 + n}", day=DAY0 + timedelta(days=days), **changes)  # type: ignore[arg-type]

    rides = [
        r(0, 0),
        r(1, 10),
        r(2, EF_TREND_DAYS - 1),  # day 27: day 0 is the window's first day (n 3)
        r(3, EF_TREND_DAYS),  # day 28: day 0 has left the window
        r(4, EF_TREND_DAYS + 1),
        r(5, 12, if_set=0.84),  # an eFTP point, not an EF ride: never counted
        r(6, 14, moving_s=120),  # too short: excluded, never counted
        r(7, 60),  # after a gap
        r(8, 61),
        r(9, 63),
        r(10, 63),  # two EF rides on one day
    ]
    metrics = analyse_rides(rides, basis=Intensity.SET_FTP)
    points = [(m.facts.day, m.ef) for m in metrics if m.ef_ok and m.ef is not None]
    counts = {m.facts.activity_id: len(ef_window(m.facts.day, points)) for m in metrics if m.ef_ok}
    return {"rows": [to_row(m, RUN_AT) for m in metrics], "counts": counts}


def test_the_web_fixture_is_pythons_current_output() -> None:
    doc: object = json.loads(json.dumps(producer()))  # as JSON
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == doc, (
        "web/tests/fixtures/ef_window.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_ef_window.py"
    )


def test_the_fixture_keeps_its_window_edges() -> None:
    counts = producer()["counts"]
    assert isinstance(counts, dict)
    assert counts["i302"] == 3  # day 27 still sees day 0
    assert counts["i303"] == 3  # day 28 no longer does (10, 27, 28)
    assert counts["i304"] == 4
    assert counts["i307"] == 1 and counts["i309"] == 4 == counts["i310"]  # same-day rides
    assert "i305" not in counts and "i306" not in counts
    assert {n for n in counts.values()} >= {1, 2, 3, 4}
