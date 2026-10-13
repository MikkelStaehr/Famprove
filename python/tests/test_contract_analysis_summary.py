"""Contract: the analysis_summary rows Python writes are the web parser's fixture (CLAUDE.md).
web/tests/fixtures/analysis_summary.json is the real producer's output (domain.cycling_answers +
db.analysis_summary) on synthetic rides: `live` = the three rows of 2026-10-13 (eFTP flat
183 vs 188 W, EF needs 3 easy rides, 0.9 h/week without a plan), `edges` = every other state.
When the producer changes, regenerate it:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_analysis_summary.py
"""

import json
import os
from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from training_load.db.analysis_summary import answer_row
from training_load.domain.cycling_answers import (
    Answer,
    cycling_answers,
    ef_answer,
    eftp_answer,
    volume_answer,
)
from training_load.domain.ride_analysis import (
    EF_MIN_RIDES,
    RideFacts,
    RideMetrics,
    analyse_rides,
    weekly_totals,
)

FIXTURE = (
    Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "analysis_summary.json"
)
TODAY = date(2026, 10, 13)
RUN_AT = datetime(2026, 10, 13, 6, 25, tzinfo=UTC)
MONDAYS = [TODAY - timedelta(days=1 + 7 * k) for k in range(8, 0, -1)]
EASY = RideFacts(
    activity_id="i0",
    day=TODAY,
    type="Ride",
    has_raw=True,
    moving_s=3600,
    distance_m=30_000.0,
    load=60,
    np_w=180,
    avg_hr=150,
    device_watts=True,
    ftp_w=230,
    if_set=0.72,
    rolling_ftp_w=200,
)


def rides(*specs: tuple[date, Mapping[str, object]]) -> list[RideMetrics]:
    return analyse_rides(
        replace(EASY, activity_id=f"i{n}", day=day, **changes)  # type: ignore[arg-type]
        for n, (day, changes) in enumerate(specs)
    )


def weekly(hours: list[float]) -> list[RideMetrics]:
    return rides(
        *(
            (monday + timedelta(days=2), {"moving_s": round(h * 3600), "if_set": 0.8})
            for monday, h in zip(MONDAYS, hours, strict=True)
            if h
        )
    )


def producer() -> dict[str, object]:
    # Live: hard rides only (IF >= 0.75), the last one without HR, as on 2026-10-13.
    live_rides = [
        *weekly([1.0, 0, 1.0, 1.0, 1.99, 0, 0, 0]),  # + the 30 Aug ride: 1.0 h before
        *rides(
            (date(2025, 9, 7), {"if_set": 0.85, "rolling_ftp_w": 233}),
            (date(2026, 8, 30), {"if_set": 0.8, "rolling_ftp_w": 188}),
            (date(2026, 10, 11), {"if_set": 0.9, "rolling_ftp_w": 183, "avg_hr": None,
                                  "moving_s": 6232}),
        ),
    ]  # fmt: skip
    weeks = weekly_totals(live_rides, first=MONDAYS[0] - timedelta(days=7), last=TODAY)
    live = cycling_answers(live_rides, weeks, [], today=TODAY)

    then_end = TODAY - timedelta(days=42)
    ef_up = rides(
        *((then_end - timedelta(days=d), {"np_w": 165}) for d in (0, 5, 10)),
        *((TODAY - timedelta(days=d), {}) for d in (0, 5, 10)),
    )
    ef_now_only = rides(*((TODAY - timedelta(days=d), {}) for d in (0, 5, 10)))
    planned_rides = weekly([0, 0, 0, 0, 3, 3, 3, 3.4])
    planned_weeks = weekly_totals(planned_rides, first=MONDAYS[0], last=TODAY)
    days = [m.facts.day for m in planned_rides]
    zero = weekly([1, 1, 1, 1, 0, 0, 0, 0])
    edges: dict[str, Answer] = {
        "eftp_none": eftp_answer([], today=TODAY),
        "eftp_stale": eftp_answer(
            rides((date(2026, 9, 1), {"if_set": 0.85, "rolling_ftp_w": 186})), today=TODAY
        ),
        "eftp_up_at_peak": eftp_answer(
            rides(
                (date(2026, 8, 30), {"if_set": 0.85, "rolling_ftp_w": 180}),
                (date(2026, 10, 11), {"if_set": 0.85, "rolling_ftp_w": 190}),
            ),
            today=TODAY,
        ),
        "eftp_delta_0": eftp_answer(
            rides(
                (date(2026, 8, 30), {"if_set": 0.85, "rolling_ftp_w": 200}),
                (date(2026, 10, 11), {"if_set": 0.85, "rolling_ftp_w": 200}),
            ),
            today=TODAY,
        ),
        "ef_up": ef_answer(ef_up, today=TODAY),
        "ef_now_only": ef_answer(ef_now_only, today=TODAY),
        "volume_plan": volume_answer(
            planned_rides, planned_weeks, [days[-1], days[-2], days[-3], MONDAYS[-1]], today=TODAY
        ),
        "volume_zero": volume_answer(
            zero, weekly_totals(zero, first=MONDAYS[0], last=TODAY), [], today=TODAY
        ),
    }
    rows = {
        "live": [answer_row(a, today=TODAY, computed_at=RUN_AT) for a in live],
        "edges": {k: answer_row(a, today=TODAY, computed_at=RUN_AT) for k, a in edges.items()},
    }
    out: dict[str, object] = json.loads(json.dumps(rows))  # as PostgREST returns JSON
    return out


def test_the_live_rows_say_what_the_spec_says() -> None:
    live = producer()["live"]
    assert isinstance(live, list)
    eftp, ef, volume = live
    assert (eftp["direction"], eftp["value"], eftp["compare"], eftp["delta"]) == (
        "flat",
        183,
        188,
        -5,
    )
    assert (ef["state"], ef["have_n"], ef["need_n"]) == ("needs_data", 0, EF_MIN_RIDES)
    assert ef["detail_text"] == "Af dine 2 seneste ture var 2 for hårde."
    assert (volume["value"], volume["direction"], volume["planned_n"]) == (
        0.9,
        "flat",
        None,
    )  # 1.99 + 0 + 0 + 1.73 h


def test_the_web_fixture_is_pythons_current_output() -> None:
    rows = producer()
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/analysis_summary.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_analysis_summary.py"
    )
