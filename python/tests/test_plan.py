"""domain.plan + cli.collect_plan: planned rides, validation and watt targets."""

from datetime import UTC, date, datetime

import pytest

from conftest import FakeResponse, FakeSend, InMemoryPostgrest
from training_load.cli import collect_plan
from training_load.config import IntervalsSettings
from training_load.domain.plan import (
    PlanError,
    Repeat,
    Step,
    TargetRepeat,
    TargetStep,
    parse_steps,
    targets,
    total_minutes,
)
from training_load.sources.intervals import parse_ride_ftp

OVER_UNDERS = [
    {"label": "Warm-up", "minutes": 10, "pct_ftp": [50, 75]},
    {
        "repeat": 4,
        "steps": [
            {"label": "On", "minutes": 8, "pct_ftp": 95},
            {"label": "Off", "minutes": 4, "pct_ftp": 55},
        ],
    },
    {"label": "Cool-down", "minutes": 10, "pct_ftp": 50},
]


def test_parse_steps_keeps_structure_and_ranges() -> None:
    items = parse_steps(OVER_UNDERS)
    assert items[0] == Step("Warm-up", 10.0, 50.0, 75.0)
    assert items[1] == Repeat(4, (Step("On", 8.0, 95.0, 95.0), Step("Off", 4.0, 55.0, 55.0)))
    assert total_minutes(items) == 10 + 4 * 12 + 10


def test_targets_round_watts_from_ftp_and_are_none_without_ftp() -> None:
    items = parse_steps(OVER_UNDERS)
    with_ftp = targets(items, ftp=250)
    assert with_ftp[0] == TargetStep("Warm-up", 10.0, 50.0, 75.0, 125, 188)  # 187.5 rounds to 188
    repeat = with_ftp[1]
    assert isinstance(repeat, TargetRepeat)
    assert [(s.label, s.watts_low, s.watts_high) for s in repeat.steps] == [
        ("On", 238, 238),  # 237.5 -> 238 (round half to even keeps 238)
        ("Off", 138, 138),  # 137.5 -> 138
    ]
    no_ftp = targets(items, ftp=None)
    assert no_ftp[0] == TargetStep("Warm-up", 10.0, 50.0, 75.0, None, None)


@pytest.mark.parametrize(
    ("steps", "message"),
    [
        ([], "non-empty list"),
        ("warm up then go hard", "non-empty list"),
        ([{"minutes": 10}], "step 1: pct_ftp must be a number"),
        ([{"minutes": 0, "pct_ftp": 50}], "step 1: minutes"),
        ([{"minutes": 10, "pct_ftp": 950}], "step 1: pct_ftp must be above 0"),
        ([{"minutes": 10, "pct_ftp": [80, 60]}], "low before high"),
        ([{"minutes": 10, "pct_ftp": 50, "watts": 200}], "unknown field 'watts'"),
        ([{"repeat": 0, "steps": [{"minutes": 1, "pct_ftp": 50}]}], "step 1: repeat"),
        ([{"repeat": 2, "steps": [{"repeat": 2, "steps": []}]}], "repeats don't nest"),
        ([{"repeat": True, "steps": [{"minutes": 1, "pct_ftp": 50}]}], "whole number"),
    ],
)
def test_parse_steps_rejects_with_plain_messages(steps: object, message: str) -> None:
    with pytest.raises(PlanError, match=message):
        parse_steps(steps)


def test_parse_ride_ftp_picks_the_ride_settings() -> None:
    athlete = {
        "sportSettings": [
            {"types": ["Run"], "ftp": None},
            {"types": ["Ride", "VirtualRide", "GravelRide"], "ftp": 250},
        ]
    }
    assert parse_ride_ftp(athlete) == 250
    assert parse_ride_ftp({"sportSettings": [{"types": ["Run"], "ftp": 300}]}) is None
    assert parse_ride_ftp({}) is None


def test_collect_plan_rebuilds_targets_keeps_problems_and_prunes(db: InMemoryPostgrest) -> None:
    db.tables["planned_sessions"] = [
        {"date": "2026-10-01", "name": "Zwift - Over-unders", "steps": OVER_UNDERS, "notes": None},
        {"date": "2026-10-04", "name": "Broken", "steps": [{"minutes": 10}], "notes": "fix me"},
    ]
    db.tables["planned_targets"] = [{"date": "2026-09-01", "name": "Old"}]
    send = FakeSend(FakeResponse(body={"sportSettings": [{"types": ["Ride"], "ftp": 250}]}))
    run_at = datetime(2026, 9, 28, 3, 0, tzinfo=UTC)

    summary = collect_plan.run(
        IntervalsSettings(api_key="k", athlete_id="i1"), send=send, db=db, computed_at=run_at
    )

    assert (summary.sessions, summary.with_problem, summary.deleted, summary.ftp) == (2, 1, 1, 250)
    rows = {r["name"]: r for r in db.tables["planned_targets"]}
    assert set(rows) == {"Zwift - Over-unders", "Broken"}
    good = rows["Zwift - Over-unders"]
    assert (good["ftp"], good["total_minutes"], good["problem"]) == (250, 68.0, None)
    steps = good["steps"]
    assert isinstance(steps, list)
    assert steps[1] == {
        "kind": "repeat",
        "repeat": 4,
        "steps": [
            {
                "kind": "step",
                "label": "On",
                "minutes": 8.0,
                "pct_low": 95.0,
                "pct_high": 95.0,
                "watts_low": 238,
                "watts_high": 238,
            },
            {
                "kind": "step",
                "label": "Off",
                "minutes": 4.0,
                "pct_low": 55.0,
                "pct_high": 55.0,
                "watts_low": 138,
                "watts_high": 138,
            },
        ],
    }
    assert rows["Broken"]["problem"] == "step 1: pct_ftp must be a number"
    assert rows["Broken"]["steps"] == []
    assert rows["Broken"]["computed_at"] == run_at.isoformat()
    assert date.fromisoformat(str(good["date"])) == date(2026, 10, 1)
