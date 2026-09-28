"""sources.intervals + cli.collect_intervals with an injected fake HttpSend and in-memory DB."""

import base64
import logging
from datetime import date

import pytest

from conftest import STRAVA_STUB, FakeResponse, FakeSend, InMemoryPostgrest, raw_ride
from training_load.cli.collect_intervals import parse_since, run
from training_load.config import IntervalsSettings
from training_load.db.activities import all_activities
from training_load.sources.intervals import basic_auth_header, fetch_activities, parse_activities

TODAY = date(2026, 3, 15)
SETTINGS = IntervalsSettings(api_key="secret-key", athlete_id="i123")


def test_basic_auth_header_uses_literal_api_key_username() -> None:
    header = basic_auth_header("secret-key")
    assert base64.b64decode(header.removeprefix("Basic ")) == b"API_KEY:secret-key"


def test_fetch_activities_sends_window_auth_and_user_agent() -> None:
    send = FakeSend(FakeResponse(body=[raw_ride("i1", "2026-03-10T07:00:00")]))
    raw = fetch_activities(
        send, api_key="k", athlete_id="i123", oldest=date(2026, 3, 1), newest=date(2026, 3, 16)
    )
    assert len(raw) == 1
    [call] = send.calls
    assert call.url == "https://intervals.icu/api/v1/athlete/i123/activities"
    assert call.params == [("oldest", "2026-03-01"), ("newest", "2026-03-16")]
    assert call.headers["Authorization"] == basic_auth_header("k")
    assert call.headers["User-Agent"].startswith("famprove-training-load/")


def test_fetch_activities_rejects_non_list_body() -> None:
    with pytest.raises(ValueError, match="array"):
        fetch_activities(
            FakeSend(FakeResponse(body={"error": "x"})),
            api_key="k",
            athlete_id="0",
            oldest=TODAY,
            newest=TODAY,
        )


def test_parse_splits_cycling_stubs_and_excluded_types() -> None:
    parsed = parse_activities(
        [
            raw_ride("i1", "2026-03-10T07:00:00", kind="Ride"),
            raw_ride("i2", "2026-03-11T18:00:00", kind="VirtualRide"),
            raw_ride("i3", "2026-03-12T17:00:00", kind="WeightTraining"),
            raw_ride("i4", "2026-03-12T19:00:00", kind="Run"),
            STRAVA_STUB,
        ]
    )
    assert [a.id for a in parsed.cycling] == ["i1", "i2"]
    assert parsed.stub_ids == ["12345678"]
    assert parsed.excluded_types == {"WeightTraining": 1, "Run": 1}


def test_parse_keeps_ride_with_null_load_and_reports_it() -> None:
    parsed = parse_activities([raw_ride("i1", "2026-03-10T07:00:00", load=None)])
    assert parsed.cycling[0].training_load is None
    assert parsed.missing_load_ids == ["i1"]


def test_parse_maps_fields_intensity_as_percent_and_naive_start() -> None:
    [activity] = parse_activities([raw_ride("i1", "2026-03-10T07:00:00")]).cycling
    assert activity.intensity_pct == 85.3
    assert activity.start_date_local.tzinfo is None
    assert (activity.training_load, activity.weighted_avg_watts, activity.ftp) == (80, 250, 290)
    assert (activity.moving_time_s, activity.elapsed_time_s) == (3600, 3700)


def test_parse_since_default_is_14_days() -> None:
    assert parse_since([], TODAY) == date(2026, 3, 1)
    assert parse_since(["--since", "2026-01-01"], TODAY) == date(2026, 1, 1)


def test_parse_since_rejects_future_date() -> None:
    with pytest.raises(SystemExit):
        parse_since(["--since", "2026-03-16"], TODAY)


def test_run_upserts_and_mirrors_deletions_only_inside_window(
    db: InMemoryPostgrest, caplog: pytest.LogCaptureFixture
) -> None:
    db.tables["activities"] = [
        {"id": "i_old", "start_date_local": "2026-02-01T07:00:00"},  # outside window: kept
        {"id": "i_gone", "start_date_local": "2026-03-05T07:00:00"},  # deleted upstream
        {"id": "12345678", "start_date_local": "2026-03-10T07:00:00"},  # stub id: never deleted
    ]
    send = FakeSend(
        FakeResponse(
            body=[
                raw_ride("i_new", "2026-03-14T18:00:00"),
                raw_ride("i_gym", "2026-03-13T18:00:00", kind="WeightTraining"),
                STRAVA_STUB,
            ]
        )
    )
    with caplog.at_level(logging.WARNING):
        summary = run(SETTINGS, send=send, db=db, since=date(2026, 3, 1), today=TODAY)

    assert send.calls[0].params == [("oldest", "2026-02-28"), ("newest", "2026-03-16")]
    assert {r["id"] for r in db.tables["activities"]} == {"i_old", "12345678", "i_new"}
    assert (summary.fetched, summary.upserted, summary.deleted) == (3, 1, 1)
    assert (summary.stubs_skipped, summary.excluded) == (1, 1)
    assert "1 Strava-sourced activities skipped" in caplog.text


def test_run_is_idempotent(db: InMemoryPostgrest) -> None:
    body = [raw_ride("i1", "2026-03-14T18:00:00"), raw_ride("i2", "2026-03-10T18:00:00")]
    for _ in range(2):
        run(
            SETTINGS,
            send=FakeSend(FakeResponse(body=body)),
            db=db,
            since=date(2026, 3, 1),
            today=TODAY,
        )
    assert sorted(a.id for a in all_activities(db)) == ["i1", "i2"]
