"""Tester's additions for slice ftp-confirm: a missing 8-min point (criterion 2), messy power-curve
values, and every way the power-curve GET can fail (criterion 12: state unchanged, planned_targets
still written, collect-plan exits 0)."""

from collections.abc import Callable
from datetime import UTC, date, datetime

import pytest
import requests

from conftest import Call, FakeResponse, FakeSend, InMemoryPostgrest
from training_load import http
from training_load.cli import collect_plan
from training_load.config import IntervalsSettings
from training_load.domain.ftp_check import ftp_status
from training_load.sources.intervals import parse_power_curves

RUN_AT = datetime(2026, 10, 15, 3, 0, tzinfo=UTC)
SETTINGS = IntervalsSettings(api_key="k", athlete_id="i1")
ATHLETE = {
    "sportSettings": [{"types": ["Ride", "VirtualRide"], "ftp": 230, "mmp_model": {"ftp": 183}}]
}
STEPS = [{"label": "Z2", "minutes": 60, "pct_ftp": 65}]


def _curves(watts_42d: object, secs: list[int] | None = None) -> dict[str, object]:
    points = secs if secs is not None else [300, 480, 600]
    return {
        "list": [
            {
                "id": "42d",
                "secs": points,
                "watts": [230, watts_42d, 190][: len(points)],
                "activity_id": ["i3"] * len(points),
            }
        ],
        "activities": {"i3": {"start_date_local": "2026-09-20T09:00:00"}},
    }


def _status_of(payload: object) -> tuple[bool | None, int | None, int]:
    curves = parse_power_curves(payload)
    status = ftp_status(
        ftp_w=230,
        eftp_w=183,
        best_42d=curves.best_42d,
        weekly=curves.weekly,
        rides=[],
        ack=None,
        today=date(2026, 10, 15),
    )
    return status.credible, status.best_8min_42d_w, curves.unreadable


def test_a_42_day_curve_without_the_480_s_point_has_no_effort_and_is_not_credible() -> None:
    assert _status_of(_curves(0, secs=[5, 60, 300])) == (False, None, 0)
    assert _status_of({"list": [], "activities": {}}) == (False, None, 0)


@pytest.mark.parametrize("watts", ["207", "207,0", "207.0", "", None, True])
def test_watts_as_text_or_blank_is_counted_unreadable_never_0_and_never_credible(
    watts: object,
) -> None:
    assert _status_of(_curves(watts)) == (False, None, 1)


def test_watts_on_the_threshold_as_a_float_is_credible() -> None:
    assert _status_of(_curves(206.6))[:2] == (True, 207)  # rounds to 207 W, the threshold
    assert _status_of(_curves(206.4))[:2] == (False, 206)


# --- criterion 12: the power-curve GET fails ----------------------------------------------------


def _db() -> InMemoryPostgrest:
    db = InMemoryPostgrest()
    db.tables["activities"] = [{"id": "a2", "start_date_local": "2026-03-21T09:00:00", "ftp": 230}]
    db.tables["planned_sessions"] = [
        {"date": "2026-10-16", "name": "Zwift Z2", "steps": STEPS, "notes": None}
    ]
    return db


def _send(curves: Callable[[], FakeResponse]) -> FakeSend:
    def handler(call: Call) -> FakeResponse:
        assert call.method == "GET", "only GETs reach intervals.icu"
        if call.url.endswith("/power-curves.json"):
            return curves()
        return FakeResponse(body=ATHLETE)

    return FakeSend(handler=handler)


def _raise(exc: Exception) -> Callable[[], FakeResponse]:
    def answer() -> FakeResponse:
        raise exc

    return answer


FAILURES: dict[str, Callable[[], FakeResponse]] = {
    "404": lambda: FakeResponse(status_code=404, body={"error": "nope"}),
    "500 after retries": lambda: FakeResponse(status_code=500, body={"error": "down"}),
    "429 after retries": lambda: FakeResponse(status_code=429, body={"error": "slow down"}),
    "body without a list": lambda: FakeResponse(body={"message": "nope"}),
    "body not json": _raise(requests.exceptions.JSONDecodeError("Expecting value", "<html>", 0)),
    "connection error": _raise(requests.ConnectionError("connection reset")),
    "timeout": _raise(requests.Timeout("read timed out")),
}


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    kwdefaults = http.request.__kwdefaults__
    assert kwdefaults is not None
    monkeypatch.setitem(kwdefaults, "sleep", lambda _s: None)


@pytest.mark.parametrize("failure", list(FAILURES))
def test_a_failed_power_curve_request_leaves_the_state_and_still_writes_planned_targets(
    failure: str,
) -> None:
    db = _db()
    good = {"list": _curves(210)["list"], "activities": _curves(210)["activities"]}
    collect_plan.run(
        SETTINGS, send=_send(lambda: FakeResponse(body=good)), db=db, computed_at=RUN_AT
    )
    before = (list(db.tables["ftp_status"]), list(db.tables["app_notices"]))
    assert [r["kind"] for r in before[1]] == ["ftp_mismatch"]  # credible 210 W >= 207 W
    db.tables["planned_targets"] = []

    summary = collect_plan.run(SETTINGS, send=_send(FAILURES[failure]), db=db, computed_at=RUN_AT)

    assert (db.tables["ftp_status"], db.tables["app_notices"]) == before, failure
    assert [r["name"] for r in db.tables["planned_targets"]] == ["Zwift Z2"], failure
    assert summary.ftp == 230


@pytest.mark.parametrize("failure", list(FAILURES))
def test_collect_plan_exits_0_when_the_power_curve_request_fails(
    failure: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = _db()
    monkeypatch.setattr(collect_plan, "load_dotenv_file", lambda *a, **k: None)
    monkeypatch.setenv("INTERVALS_API_KEY", "k")
    monkeypatch.setenv("INTERVALS_ATHLETE_ID", "i1")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "sb_secret_x")
    monkeypatch.setattr(collect_plan, "requests_send", lambda: _send(FAILURES[failure]))
    monkeypatch.setattr(collect_plan, "Postgrest", lambda *a, **k: db)

    assert collect_plan.main([]) == 0, failure
    assert [r["name"] for r in db.tables["planned_targets"]] == ["Zwift Z2"], failure
    assert db.tables.get("ftp_status", []) == [], failure
