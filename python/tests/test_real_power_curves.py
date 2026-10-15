"""The ride power curves as intervals.icu returns them for one GET of 42d + 52 ISO weeks
(fixtures/power_curves_slice.json: a real response of 2026-10-15, anonymised; refresh it when
intervals.icu changes the format). Slice ftp-confirm."""

import itertools
import json
from datetime import date
from pathlib import Path

from training_load.domain.ftp_check import CREDIBLE_EFFORT_S
from training_load.sources.intervals import parse_power_curves

PAYLOAD = json.loads(
    (Path(__file__).parent / "fixtures" / "power_curves_slice.json").read_text(encoding="utf-8")
)


def test_the_real_response_parses_whole() -> None:
    curves = parse_power_curves(PAYLOAD)
    assert curves.has_42d and curves.best_42d is not None
    assert curves.unreadable == 0
    assert curves.weekly and all(e.on is not None for e in curves.weekly)


def test_every_listed_week_holds_the_8_min_point_and_its_ride_lies_in_that_week() -> None:
    weeks = [c for c in PAYLOAD["list"] if c["id"].startswith("r.")]
    assert len(weeks) == len(parse_power_curves(PAYLOAD).weekly)
    for curve in weeks:
        assert CREDIBLE_EFFORT_S in curve["secs"]  # the grid has 480 s itself, no stand-in today
        ride = curve["activity_id"][curve["secs"].index(CREDIBLE_EFFORT_S)]
        start, end = (date.fromisoformat(d) for d in curve["id"][2:].split("."))
        on = date.fromisoformat(PAYLOAD["activities"][ride]["start_date_local"])
        assert start <= on <= end, curve["id"]


def test_a_real_curve_can_rise_with_duration_so_every_point_from_8_min_counts() -> None:
    """Why the effort is the best of every point from 480 s on: real curves rise by a watt or two
    in places, so the 8-min point alone could miss an effort of 8 min or more at the threshold."""
    rises = 0
    for curve in PAYLOAD["list"]:
        pairs = list(zip(curve["secs"], curve["watts"], strict=True))
        rises += sum(b[1] > a[1] for a, b in itertools.pairwise(pairs))
        longer = [w for s, w in pairs if s >= CREDIBLE_EFFORT_S]
        if curve["id"] == "42d":
            assert parse_power_curves(PAYLOAD).best_42d is not None
            assert parse_power_curves(PAYLOAD).best_42d.watts == max(longer)  # type: ignore[union-attr]
    assert rises > 0
