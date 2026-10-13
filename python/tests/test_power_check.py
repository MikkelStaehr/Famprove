"""Power data checks: the spike warning per ride and the FTP sanity notice (2026-10-13)."""

from collections.abc import Mapping
from datetime import UTC, date, datetime
from typing import Any

import pytest

from conftest import Call, FakeResponse, FakeSend, InMemoryPostgrest
from training_load.cli.collect_intervals import with_power_checks
from training_load.db.app_notices import set_notice
from training_load.domain.cycling import CyclingActivity
from training_load.domain.power_check import (
    FTP_NOTICE_KIND,
    Spike,
    data_warning,
    ftp_notice,
    largest_spike,
    needs_stream,
)
from training_load.sources.intervals import parse_power_stream, parse_ride_ftps


def test_the_stream_is_fetched_only_above_twice_the_ftp() -> None:
    assert needs_stream(501, 250)
    assert not needs_stream(500, 250)
    assert not needs_stream(None, 250)
    assert not needs_stream(900, None)


def test_a_spike_stands_more_than_300_w_above_both_neighbours() -> None:
    watts = [200, 210, 900, 650, 220, 1300, 980, 230]
    # 900: 250 above 650 -> no; 1300: 320 above 980 -> yes (the larger of the two neighbours counts)
    assert largest_spike(watts, list(range(len(watts)))) == Spike(watts=1300, above=320, at_s=5)
    assert largest_spike([200, 600, 200]) == Spike(watts=600, above=400, at_s=None)
    assert largest_spike([200, 501, 200]) == Spike(watts=501, above=301, at_s=None)
    assert largest_spike([200, 500, 200]) is None  # 300 is not more than 300
    assert largest_spike([None, 1500, 200]) is None  # a missing neighbour never makes a spike
    assert largest_spike([1500]) is None


def test_the_warning_says_which_rule_fired_with_danish_numbers() -> None:
    assert data_warning(1650, 1210.0, None) == "Maks 1.650 W er over 1,3 × din ePmax (1.210 W)."  # noqa: RUF001
    assert data_warning(1500, 1210.0, None) is None  # 1500 <= 1573
    spike = Spike(watts=1180, above=640, at_s=2533)
    assert (
        data_warning(981, 1210.0, spike)
        == "Ét sample på 1.180 W ligger 640 W over begge naboer efter 42:13."
    )
    both = data_warning(1650, 1210.0, Spike(watts=1650, above=900, at_s=3725))
    assert both is not None and both.count(";") == 1 and "1:02:05" in both
    assert data_warning(None, None, None) is None


@pytest.mark.parametrize(
    ("ftp", "eftp", "expected"),
    [
        (230, 183, "FTP er sat til 230 W, men dine ture peger på 183 W"),  # 20 % apart
        (250, 183, "FTP er sat til 250 W, men dine ture peger på 183 W"),
        (230, 200, None),  # 13 %: they agree
        (200, 230, None),  # 15 % of 200 = 30: exactly at the limit is agreement
        (200, 231, "FTP er sat til 200 W, men dine ture peger på 231 W"),
        (None, 183, None),
        (230, None, None),
    ],
)
def test_ftp_notice_while_ftp_and_eftp_differ_by_more_than_15_percent(
    ftp: int | None, eftp: int | None, expected: str | None
) -> None:
    assert ftp_notice(ftp, eftp) == expected


def test_sport_settings_give_ftp_and_the_power_models_eftp() -> None:
    athlete = {
        "sportSettings": [
            {"types": ["Run"], "ftp": 300},
            {"types": ["Ride", "VirtualRide"], "ftp": 230, "mmp_model": {"ftp": 183, "pMax": 1227}},
        ]
    }
    got = parse_ride_ftps(athlete)
    assert (got.ftp, got.eftp) == (230, 183)
    assert parse_ride_ftps({"sportSettings": [{"types": ["Ride"], "ftp": 230}]}).eftp is None


def test_the_power_stream_parses_watts_and_time_and_keeps_gaps() -> None:
    payload = [{"type": "time", "data": [0, 1, 2]}, {"type": "watts", "data": [180.4, None, "x"]}]
    assert parse_power_stream(payload) == ([180, None, None], [0, 1, 2])
    assert parse_power_stream([{"type": "time", "data": [0]}]) is None
    with pytest.raises(ValueError):
        parse_power_stream({"watts": []})


def ride(activity_id: str, *, ftp: int, pmax: int | None, epmax: float | None) -> CyclingActivity:
    raw: dict[str, Any] = {"icu_pm_p_max": pmax, "icu_rolling_p_max": epmax}
    return CyclingActivity(
        id=activity_id,
        start_date_local=datetime(2026, 10, 11, 9, 0),
        type="Ride",
        name="Morning Ride",
        training_load=87,
        weighted_avg_watts=177,
        intensity_pct=71.0,
        ftp=ftp,
        moving_time_s=6240,
        elapsed_time_s=6500,
        power_load=87,
        hr_load=None,
        raw=raw,
    )


def stream_send(streams: Mapping[str, object], fail: frozenset[str] = frozenset()) -> FakeSend:
    def handler(call: Call) -> FakeResponse:
        activity_id = call.url.split("/activity/")[1].split("/")[0]
        assert call.url.endswith("/streams") and dict(call.params or []) == {"types": "time,watts"}
        if activity_id in fail:
            return FakeResponse(status_code=500, body={})
        return FakeResponse(body=streams[activity_id])

    return FakeSend(handler=handler)


def test_collect_checks_every_ride_and_fetches_streams_only_for_candidates() -> None:
    rides = [
        ride("i1", ftp=230, pmax=400, epmax=1210.0),  # below 2 x FTP: no stream, no warning
        ride("i2", ftp=230, pmax=1700, epmax=1210.0),  # peak rule; a candidate with a clean stream
        ride("i3", ftp=230, pmax=981, epmax=1210.0),  # a candidate with one spike
    ]
    streams = {
        "i2": [{"type": "time", "data": [0, 1, 2]}, {"type": "watts", "data": [300, 320, 310]}],
        "i3": [{"type": "time", "data": [0, 1, 2]}, {"type": "watts", "data": [250, 981, 260]}],
    }
    send = stream_send(streams)
    checked, read, unread = with_power_checks(rides, send=send, api_key="k")
    assert (read, unread) == (2, 0)
    assert [len(send.calls)] == [2]
    assert checked[0].data_warning is None
    assert checked[1].data_warning == "Maks 1.700 W er over 1,3 × din ePmax (1.210 W)."  # noqa: RUF001
    assert (
        checked[2].data_warning == "Ét sample på 981 W ligger 721 W over begge naboer efter 0:01."
    )


def test_a_stream_that_cannot_be_read_is_counted_and_the_peak_rule_still_applies() -> None:
    rides = [ride("i2", ftp=230, pmax=1700, epmax=1210.0)]
    checked, read, unread = with_power_checks(
        rides, send=stream_send({}, fail=frozenset({"i2"})), api_key="k"
    )
    assert (read, unread) == (0, 1)
    assert checked[0].data_warning is not None and checked[0].data_warning.startswith(
        "Maks 1.700 W"
    )


def test_the_ftp_notice_is_written_while_it_holds_and_cleared_after() -> None:
    db = InMemoryPostgrest()
    now = datetime(2026, 10, 13, 6, 0, tzinfo=UTC)
    set_notice(db, FTP_NOTICE_KIND, ftp_notice(230, 183), today=date(2026, 10, 13), now=now)
    assert [(r["kind"], r["message"]) for r in db.tables["app_notices"]] == [
        ("ftp_mismatch", "FTP er sat til 230 W, men dine ture peger på 183 W")
    ]
    set_notice(db, FTP_NOTICE_KIND, ftp_notice(230, 183), today=date(2026, 10, 14), now=now)
    assert len(db.tables["app_notices"]) == 1  # one current notice per kind
    set_notice(db, FTP_NOTICE_KIND, ftp_notice(230, 205), today=date(2026, 10, 15), now=now)
    assert db.tables["app_notices"] == []
