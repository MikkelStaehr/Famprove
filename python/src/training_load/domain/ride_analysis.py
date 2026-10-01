"""Analyse / Cykel: per-ride trend values and weekly totals ("am I getting fitter on the bike?").

Rules agreed with the user (2026-10-01):
- Window: rides from ANALYSIS_START (2024-12-30, the ISO week of 2025-01-01). CTL/ATL keep
  their own start (SERIES_START).
- Exclusions are analytics-only and visible: a ride left out of the trends keeps its row and a
  reason. Weekly hours and load count every ride, so they match /load.
- too_short: moving time < 5 min (or unknown), or a known distance < 1 km. A missing distance
  never excludes.
- A power ride has a real power meter (device_watts) and NP. Rides without one count for hours
  and load, never for the power trends.
- power_outlier (out of eFTP and EF), power rides only: the day's rolling eFTP outside
  100-500 W; or, on a ride of 30 min or more, NP < 50 W or IF on the set FTP > 1.15.
- hr_outlier (out of EF only): on a ride of 30 min or more, average HR outside 80-200 bpm.
- eFTP point: intervals.icu's rolling eFTP on the day of each valid power ride, as delivered.
- EF = NP / average HR. An EF point is an eFTP point with HR, at least 30 min, and endurance
  intensity (< 0.75 on the ENDURANCE basis). EF trend = median of the EF points in the 28 days
  ending on the ride's date.
- A line breaks when more than 21 days pass between two points (no carrying forward).
- A year ago (for the headline): the latest eFTP point 365-386 days before an eFTP point.
"""

import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum
from typing import Final, Literal

from training_load.domain.strength import iso_week_start

type Exclusion = Literal["no_raw", "too_short", "power_outlier", "hr_outlier"]


class Intensity(Enum):
    """Which FTP the endurance filter divides NP by."""

    SET_FTP = "set_ftp"  # intervals.icu's IF: the FTP set in intervals.icu at the time
    ROLLING_EFTP = "rolling_eftp"  # NP / intervals.icu's rolling eFTP on the day


ENDURANCE: Final = Intensity.ROLLING_EFTP
"""The user's choice (2026-10-01): their set FTP (250 W) is outdated. Measured on real data:
0 rides since 2025 qualify on this basis (eFTP is a floor), 11 on SET_FTP. Pending the user."""

ENDURANCE_MAX_IF: Final = 0.75
MIN_MOVING_S: Final = 5 * 60
MIN_DISTANCE_M: Final = 1000.0
LONG_RIDE_S: Final = 30 * 60
"""Outlier checks and EF points only apply to rides at least this long."""
MIN_NP_W: Final = 50
MAX_IF_SET: Final = 1.15
EFTP_BOUNDS_W: Final = (100, 500)
HR_BOUNDS_BPM: Final = (80, 200)
EF_TREND_DAYS: Final = 28
MAX_GAP_DAYS: Final = 21
YEAR_AGO_DAYS: Final = (365, 386)
"""The comparison point for an eFTP point: the latest eFTP point this many days earlier."""


@dataclass(frozen=True, slots=True)
class RideFacts:
    """One ride, narrowed from activities (typed columns + raw). Missing is None, never 0."""

    activity_id: str
    day: date
    type: str
    has_raw: bool  # False: the raw-only fields below are unknown, not absent
    moving_s: int | None
    distance_m: float | None
    load: int | None
    np_w: int | None
    avg_hr: int | None
    device_watts: bool | None
    ftp_w: int | None  # the FTP set in intervals.icu at the time
    if_set: float | None  # intervals.icu IF as a ratio (on ftp_w; HR-based without power)
    rolling_ftp_w: int | None  # intervals.icu's eFTP on the day


@dataclass(frozen=True, slots=True)
class RideMetrics:
    facts: RideFacts
    if_eftp: float | None
    ef: float | None
    exclusion: Exclusion | None
    eftp_ok: bool
    eftp_gap_before: bool
    ef_ok: bool
    ef_trend: float | None
    ef_gap_before: bool
    eftp_year_ago: tuple[date, int] | None = None  # (day, W) of the comparison point


@dataclass(frozen=True, slots=True)
class CyclingWeek:
    week_start: date  # ISO Monday
    rides: int
    moving_s: int
    load: int
    excluded: int


def is_power_ride(f: RideFacts) -> bool:
    return f.device_watts is True and f.np_w is not None


def _long(f: RideFacts) -> bool:
    return f.moving_s is not None and f.moving_s >= LONG_RIDE_S


def classify(f: RideFacts) -> Exclusion | None:
    """Why the ride is left out of the trends, first match wins; None = in."""
    if not f.has_raw:
        return "no_raw"
    if (f.moving_s is None or f.moving_s < MIN_MOVING_S) or (
        f.distance_m is not None and f.distance_m < MIN_DISTANCE_M
    ):
        return "too_short"
    if is_power_ride(f):
        assert f.np_w is not None  # is_power_ride
        eftp_low, eftp_high = EFTP_BOUNDS_W
        if f.rolling_ftp_w is not None and not eftp_low <= f.rolling_ftp_w <= eftp_high:
            return "power_outlier"
        if _long(f) and (f.np_w < MIN_NP_W or (f.if_set is not None and f.if_set > MAX_IF_SET)):
            return "power_outlier"
    hr_low, hr_high = HR_BOUNDS_BPM
    if f.avg_hr is not None and _long(f) and not hr_low <= f.avg_hr <= hr_high:
        return "hr_outlier"
    return None


def if_on_eftp(f: RideFacts) -> float | None:
    """NP / the day's rolling eFTP on a power ride; None without both."""
    if not is_power_ride(f) or not f.rolling_ftp_w:
        return None
    assert f.np_w is not None
    return f.np_w / f.rolling_ftp_w


def efficiency_factor(f: RideFacts) -> float | None:
    """NP / average HR on a power ride with HR; None otherwise."""
    if not is_power_ride(f) or not f.avg_hr:
        return None
    assert f.np_w is not None
    return f.np_w / f.avg_hr


def _endurance(f: RideFacts, basis: Intensity) -> bool:
    intensity = if_on_eftp(f) if basis is Intensity.ROLLING_EFTP else f.if_set
    return intensity is not None and intensity < ENDURANCE_MAX_IF


def _gaps(days: Sequence[date]) -> list[bool]:
    """True where the previous point is more than MAX_GAP_DAYS earlier, or there is none."""
    return [i == 0 or (d - days[i - 1]).days > MAX_GAP_DAYS for i, d in enumerate(days)]


def analyse_rides(rides: Iterable[RideFacts], *, basis: Intensity = ENDURANCE) -> list[RideMetrics]:
    """Every ride, ordered by (day, activity_id), with its trend values and exclusion."""
    ordered = sorted(rides, key=lambda f: (f.day, f.activity_id))
    first: list[tuple[RideFacts, Exclusion | None, bool, bool, float | None]] = []
    for f in ordered:
        exclusion = classify(f)
        eftp_ok = (
            is_power_ride(f) and f.rolling_ftp_w is not None and exclusion in (None, "hr_outlier")
        )
        ef = efficiency_factor(f)
        ef_ok = (
            eftp_ok and exclusion is None and ef is not None and _long(f) and _endurance(f, basis)
        )
        first.append((f, exclusion, eftp_ok, ef_ok, ef))

    eftp_rides = [f for f, _, ok, _, _ in first if ok]
    eftp_gap = dict(
        zip((f.activity_id for f in eftp_rides), _gaps([f.day for f in eftp_rides]), strict=True)
    )
    ef_rides = [(f, ef) for f, _, _, ok, ef in first if ok and ef is not None]
    ef_points = [(f.day, ef) for f, ef in ef_rides]
    ef_gap = dict(
        zip((f.activity_id for f, _ in ef_rides), _gaps([d for d, _ in ef_points]), strict=True)
    )

    def year_ago(day: date) -> tuple[date, int] | None:
        lo, hi = day - timedelta(days=YEAR_AGO_DAYS[1]), day - timedelta(days=YEAR_AGO_DAYS[0])
        earlier = [(p.day, p.rolling_ftp_w) for p in eftp_rides if lo <= p.day <= hi]
        found = max(earlier, key=lambda point: point[0], default=None)
        return None if found is None or found[1] is None else (found[0], found[1])

    out: list[RideMetrics] = []
    for f, exclusion, eftp_ok, ef_ok, ef in first:
        trend = None
        if ef_ok:
            since = f.day - timedelta(days=EF_TREND_DAYS - 1)
            trend = statistics.median(v for d, v in ef_points if since <= d <= f.day)
        out.append(
            RideMetrics(
                facts=f,
                if_eftp=if_on_eftp(f),
                ef=ef,
                exclusion=exclusion,
                eftp_ok=eftp_ok,
                eftp_gap_before=eftp_ok and eftp_gap[f.activity_id],
                ef_ok=ef_ok,
                ef_trend=trend,
                ef_gap_before=ef_ok and ef_gap[f.activity_id],
                eftp_year_ago=year_ago(f.day) if eftp_ok else None,
            )
        )
    return out


def weekly_totals(rides: Sequence[RideMetrics], *, first: date, last: date) -> list[CyclingWeek]:
    """One row per ISO week from first's week to last's week, 0 for a week without rides.
    Every ride counts (exclusions are trend-only); a missing moving time or load adds 0 to the
    sums (the caller logs how many). Rides outside the weeks are ignored."""
    weeks: dict[date, list[RideMetrics]] = {}
    week = iso_week_start(first)
    while week <= iso_week_start(last):
        weeks[week] = []
        week += timedelta(days=7)
    for r in rides:
        bucket = weeks.get(iso_week_start(r.facts.day))
        if bucket is not None:
            bucket.append(r)
    return [
        CyclingWeek(
            week_start=w,
            rides=len(rs),
            moving_s=sum(r.facts.moving_s or 0 for r in rs),
            load=sum(r.facts.load or 0 for r in rs),
            excluded=sum(1 for r in rs if r.exclusion is not None),
        )
        for w, rs in weeks.items()
    ]
