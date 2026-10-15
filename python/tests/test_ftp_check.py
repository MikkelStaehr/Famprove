"""The FTP check (slice ftp-confirm, user 2026-10-15): credibility from the power curve's 8-min
point, "ikke testet siden", "sat senest", the confirmation's suppression, the power-curve source,
and collect-plan's wiring (one GET more, nothing written to intervals.icu)."""

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import pytest

from conftest import Call, FakeResponse, FakeSend, InMemoryPostgrest
from training_load.cli import collect_plan
from training_load.config import IntervalsSettings
from training_load.domain.ftp_check import (
    Effort,
    FtpAck,
    FtpStatus,
    ftp_since,
    ftp_status,
    is_credible,
    last_tested_on,
    notice_message,
    suppressed_until,
    threshold_w,
)
from training_load.sources.intervals import parse_power_curves, power_curve_ranges

TODAY = date(2026, 10, 15)


# --- credibility (criterion 2) ---------------------------------------------------------------


def test_credible_from_90_percent_of_the_ftp_set() -> None:
    assert threshold_w(230) == 207
    assert threshold_w(250) == 225
    assert is_credible(Effort(206, date(2026, 10, 1)), 230) is False
    assert is_credible(Effort(207, date(2026, 10, 1)), 230) is True
    assert is_credible(None, 230) is False  # no 8-min effort with power in 42 days
    assert is_credible(Effort(300, None), None) is None  # no FTP: nothing to judge
    assert threshold_w(None) is None and threshold_w(0) is None


def test_last_tested_is_the_latest_effort_at_the_threshold() -> None:
    weekly = [
        Effort(266, date(2025, 9, 7)),
        Effort(219, date(2026, 4, 19)),
        Effort(221, date(2026, 5, 17)),
        Effort(203, date(2026, 8, 30)),
        Effort(250, None),  # an unnamed ride never dates a test
    ]
    assert last_tested_on(weekly, 230) == date(2026, 5, 17)
    assert last_tested_on(weekly[3:], 230) is None
    assert last_tested_on(weekly, None) is None


def test_ftp_since_is_the_first_ride_of_the_latest_run_with_this_ftp() -> None:
    rides = [
        (date(2025, 9, 7), 250),
        (date(2026, 3, 21), 230),
        (date(2025, 7, 18), 250),
        (date(2026, 10, 11), 230),
    ]
    assert ftp_since(rides, 230) == date(2026, 3, 21)
    assert ftp_since(rides, 240) is None  # changed after the latest ride: unknown
    assert ftp_since([], 230) is None
    assert ftp_since([(date(2026, 5, 1), 230), (date(2026, 6, 1), None)], 230) is None


# --- suppression after "230 W er rigtigt" (criterion 5) ---------------------------------------

ACK_AT = datetime(2026, 10, 15, 8, 0, tzinfo=UTC)  # local date 2026-10-15
CONFIRMED = FtpAck("confirmed", 230, 183, ACK_AT)


def _until(
    ack: FtpAck, *, today: date, ftp: int = 230, eftp: int = 183, efforts: Sequence[Effort] = ()
) -> date | None:
    return suppressed_until(ack, ftp_w=ftp, eftp_w=eftp, efforts=list(efforts), today=today)


def test_hidden_for_60_days_from_the_ack() -> None:
    assert _until(CONFIRMED, today=TODAY + timedelta(days=59)) == date(2026, 12, 14)
    assert _until(CONFIRMED, today=TODAY + timedelta(days=60)) is None


def test_an_ftp_change_ends_the_confirmation() -> None:
    assert _until(CONFIRMED, today=TODAY, ftp=220) is None


def test_a_hard_effort_after_the_ack_with_eftp_moved_over_5_percent_ends_it() -> None:
    after = [Effort(215, date(2026, 10, 20))]
    assert _until(CONFIRMED, today=date(2026, 10, 21), eftp=193, efforts=after) is None  # +5.5 %
    assert _until(CONFIRMED, today=date(2026, 10, 21), eftp=190, efforts=after) == date(
        2026, 12, 14
    )  # +3.8 %
    on_the_day = [Effort(215, date(2026, 10, 15))]
    assert _until(CONFIRMED, today=TODAY, eftp=200, efforts=on_the_day) == date(2026, 12, 14)
    easy = [Effort(200, date(2026, 10, 20))]  # below 207: not a hard effort
    assert _until(CONFIRMED, today=date(2026, 10, 21), eftp=200, efforts=easy) == date(2026, 12, 14)


def test_fixed_and_no_answer_never_suppress() -> None:
    assert _until(FtpAck("fixed", 230, 183, ACK_AT), today=TODAY) is None
    assert suppressed_until(None, ftp_w=230, eftp_w=183, efforts=[], today=TODAY) is None


def test_the_notice_needs_credible_mismatch_and_no_suppression() -> None:
    def status(best: int, ack: FtpAck | None = None, eftp: int = 183) -> FtpStatus:
        return ftp_status(
            ftp_w=230,
            eftp_w=eftp,
            best_42d=Effort(best, date(2026, 10, 1)),
            weekly=[],
            rides=[],
            ack=ack,
            today=TODAY,
        )

    assert notice_message(status(202)) is None  # today's real data: not credible
    assert notice_message(status(210)) == "FTP er sat til 230 W, men dine ture peger på 183 W"
    assert notice_message(status(210, CONFIRMED)) is None
    assert notice_message(status(210, eftp=205)) is None  # credible, but within 15 %


# --- the source: one GET's curves -------------------------------------------------------------


def test_ranges_are_42_days_then_each_iso_week_this_week_first() -> None:
    ranges = power_curve_ranges(TODAY, 52)
    assert len(ranges) == 53
    assert ranges[:3] == ["42d", "r.2026-10-12.2026-10-18", "r.2026-10-05.2026-10-11"]


def _curve(cid: str, watts: object, ride: object = "i1") -> dict[str, object]:
    return {
        "id": cid,
        "secs": [300, 480, 600],
        "watts": [230, watts, 190],
        "activity_id": ["i0", ride, "i0"],
    }


def test_power_curves_take_the_8_min_point_and_count_what_cannot_be_read() -> None:
    payload = {
        "list": [
            _curve("42d", 202),
            _curve("r.2026-05-11.2026-05-17", 221.4, "i2"),
            {"id": "r.2026-05-04.2026-05-10", "secs": [5, 60], "watts": [600, 300]},  # short ride
            _curve("r.2026-04-27.2026-05-03", "x"),  # unreadable watts
            _curve("r.2026-04-20.2026-04-26", 208, "i9"),  # ride not named in activities
        ],
        "activities": {
            "i1": {"start_date_local": "2026-09-20T09:00:00"},
            "i2": {"start_date_local": "2026-05-17T08:00:00"},
        },
    }
    curves = parse_power_curves(payload)
    assert curves.best_42d == Effort(202, date(2026, 9, 20))
    assert curves.weekly == [Effort(221, date(2026, 5, 17)), Effort(208, None)]
    assert curves.unreadable == 2
    with pytest.raises(ValueError):
        parse_power_curves({"message": "nope"})


# --- collect-plan wiring (criteria 1, 3-4, 6, 12) ----------------------------------------------

RUN_AT = datetime(2026, 10, 15, 3, 0, tzinfo=UTC)
SETTINGS = IntervalsSettings(api_key="k", athlete_id="i1")


def _send(best_42d: int, *, curves_status: int = 200) -> FakeSend:
    athlete = {
        "sportSettings": [{"types": ["Ride", "VirtualRide"], "ftp": 230, "mmp_model": {"ftp": 183}}]
    }
    curves = {
        "list": [_curve("42d", best_42d, "i3"), _curve("r.2026-05-11.2026-05-17", 221, "i2")],
        "activities": {
            "i2": {"start_date_local": "2026-05-17T08:00:00"},
            "i3": {"start_date_local": "2026-09-20T09:00:00"},
        },
    }

    def handler(call: Call) -> FakeResponse:
        if call.url.endswith("/power-curves.json"):
            return FakeResponse(status_code=curves_status, body=curves)
        return FakeResponse(body=athlete)

    return FakeSend(handler=handler)


def _db() -> InMemoryPostgrest:
    db = InMemoryPostgrest()
    db.tables["activities"] = [
        {"id": "a1", "start_date_local": "2025-09-07T09:00:00", "ftp": 250},
        {"id": "a2", "start_date_local": "2026-03-21T09:00:00", "ftp": 230},
        {"id": "a3", "start_date_local": "2026-10-11T09:00:00", "ftp": 230},
    ]
    return db


def test_collect_plan_writes_the_ftp_status_and_reads_intervals_with_gets_only() -> None:
    db, send = _db(), _send(202)
    collect_plan.run(SETTINGS, send=send, db=db, computed_at=RUN_AT)
    assert [c.method for c in send.calls] == ["GET", "GET"]
    assert sum(c.url.endswith("/power-curves.json") for c in send.calls) == 1
    [row] = db.tables["ftp_status"]
    assert {k: row[k] for k in row if k != "checked_at"} == {
        "singleton": True,
        "ftp_w": 230,
        "eftp_w": 183,
        "best_8min_42d_w": 202,
        "threshold_w": 207,
        "credible": False,
        "last_tested_on": "2026-05-17",
        "ftp_since": "2026-03-21",
        "suppressed_until": None,
    }
    assert db.tables["app_notices"] == []  # not credible: the quiet line, no warning


def test_a_credible_mismatch_writes_the_notice_and_a_confirmation_suppresses_it() -> None:
    db = _db()
    collect_plan.run(SETTINGS, send=_send(210), db=db, computed_at=RUN_AT)
    assert [r["kind"] for r in db.tables["app_notices"]] == ["ftp_mismatch"]
    db.tables["ftp_ack"] = [
        {
            "id": 1,
            "choice": "fixed",
            "ftp_w": 230,
            "eftp_w": 183,
            "at": "2026-10-10T08:00:00+00:00",
        },
        {
            "id": 2,
            "choice": "confirmed",
            "ftp_w": 230,
            "eftp_w": 183,
            "at": "2026-10-14T19:00:00+00:00",
        },
    ]
    collect_plan.run(SETTINGS, send=_send(210), db=db, computed_at=RUN_AT)
    assert db.tables["app_notices"] == []
    assert db.tables["ftp_status"][0]["suppressed_until"] == "2026-12-13"


def test_unreadable_power_curves_leave_the_check_as_it_was_and_the_run_goes_on() -> None:
    db = _db()
    collect_plan.run(SETTINGS, send=_send(210), db=db, computed_at=RUN_AT)
    before = (list(db.tables["ftp_status"]), list(db.tables["app_notices"]))
    summary = collect_plan.run(
        SETTINGS, send=_send(210, curves_status=404), db=db, computed_at=RUN_AT
    )
    assert (db.tables["ftp_status"], db.tables["app_notices"]) == before
    assert summary.ftp == 230  # planned_targets were still built
