"""intervals.icu API: fetch activities (and wellness for the live parity test), map to domain.

Auth: HTTP Basic, username literally "API_KEY", password = the key. Every request goes
through ``http.request`` (explicit User-Agent, 429 Retry-After handling; limit 10 req/s/IP).
The activities endpoint has no paging (``limit`` only): never pass ``limit``, so a window
is always complete, which mirrored deletions depend on.
"""

import base64
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final
from urllib.parse import quote

from training_load.domain.cycling import CyclingActivity, is_cycling
from training_load.http import HttpSend, request
from training_load.narrow import (
    json_objects,
    opt_float,
    opt_int,
    opt_str,
    req_date,
    req_naive_datetime,
    req_str,
)

BASE_URL: Final = "https://intervals.icu/api/v1"
BASIC_AUTH_USER: Final = "API_KEY"

type RawActivity = Mapping[str, object]
"""One activity object as decoded from JSON; narrowed field by field in parse_activities."""


@dataclass(frozen=True, slots=True)
class ParsedActivities:
    cycling: list[CyclingActivity]
    stub_ids: list[str]
    """Strava-sourced stubs (source == "STRAVA", no type/load): skipped, logged as a warning,
    and never mirror-deleted."""
    excluded_types: Counter[str]
    """Non-cycling activities by type (WeightTraining, Run, ...), for the run log."""
    missing_load_ids: list[str]
    """Cycling activities with icu_training_load null: kept (load counts as 0), logged."""


@dataclass(frozen=True, slots=True)
class WellnessDay:
    date: date
    ctl: float | None
    atl: float | None
    ctl_load: float | None
    atl_load: float | None


def basic_auth_header(api_key: str) -> str:
    """``"Basic " + base64("API_KEY:" + api_key)``."""
    token = base64.b64encode(f"{BASIC_AUTH_USER}:{api_key}".encode()).decode("ascii")
    return f"Basic {token}"


def _get_list(
    send: HttpSend, path: str, *, api_key: str, athlete_id: str, oldest: date, newest: date
) -> list[Mapping[str, object]]:
    url = f"{BASE_URL}/athlete/{quote(athlete_id, safe='')}/{path}"
    response = request(
        send,
        "GET",
        url,
        headers={"Authorization": basic_auth_header(api_key), "Accept": "application/json"},
        params=[("oldest", oldest.isoformat()), ("newest", newest.isoformat())],
    )
    return json_objects(response.json(), f"intervals.icu {path}")


def fetch_activities(
    send: HttpSend, *, api_key: str, athlete_id: str, oldest: date, newest: date
) -> list[RawActivity]:
    """GET /athlete/{athlete_id}/activities?oldest=&newest= (ISO dates), newest first.

    Raises if the body is not a JSON list of objects.
    """
    return _get_list(
        send, "activities", api_key=api_key, athlete_id=athlete_id, oldest=oldest, newest=newest
    )


def parse_activities(raw: Sequence[RawActivity]) -> ParsedActivities:
    """Split raw activities into cycling / stubs / excluded, mapping fields:

    id, start_date_local ("YYYY-MM-DDTHH:MM:SS", naive), type, name, icu_training_load,
    icu_weighted_avg_watts, icu_intensity (percent, stored as-is), icu_ftp, moving_time,
    elapsed_time, power_load, hr_load.
    A stub is an object with no "type" (typically source == "STRAVA").
    """
    parsed = ParsedActivities(
        cycling=[], stub_ids=[], excluded_types=Counter(), missing_load_ids=[]
    )
    for obj in raw:
        activity_type = obj.get("type")
        if activity_type is None:
            parsed.stub_ids.append(str(obj.get("id")))
            continue
        if not isinstance(activity_type, str):
            raise ValueError("intervals.icu activity: field 'type' must be a string")
        if not is_cycling(activity_type):
            parsed.excluded_types[activity_type] += 1
            continue
        activity = CyclingActivity(
            id=req_str(obj, "id"),
            start_date_local=req_naive_datetime(obj, "start_date_local"),
            type=activity_type,
            name=opt_str(obj, "name"),
            training_load=opt_int(obj, "icu_training_load"),
            weighted_avg_watts=opt_int(obj, "icu_weighted_avg_watts"),
            intensity_pct=opt_float(obj, "icu_intensity"),
            ftp=opt_int(obj, "icu_ftp"),
            moving_time_s=opt_int(obj, "moving_time"),
            elapsed_time_s=opt_int(obj, "elapsed_time"),
            power_load=opt_int(obj, "power_load"),
            hr_load=opt_int(obj, "hr_load"),
        )
        if activity.training_load is None:
            parsed.missing_load_ids.append(activity.id)
        parsed.cycling.append(activity)
    return parsed


def fetch_wellness(
    send: HttpSend, *, api_key: str, athlete_id: str, oldest: date, newest: date
) -> list[WellnessDay]:
    """GET /athlete/{athlete_id}/wellness?oldest=&newest= (newest inclusive).

    Per day: id (date), ctl, atl, ctlLoad, atlLoad. Used only by the live parity test.
    """
    days = _get_list(
        send, "wellness", api_key=api_key, athlete_id=athlete_id, oldest=oldest, newest=newest
    )
    return [
        WellnessDay(
            date=req_date(day, "id"),
            ctl=opt_float(day, "ctl"),
            atl=opt_float(day, "atl"),
            ctl_load=opt_float(day, "ctlLoad"),
            atl_load=opt_float(day, "atlLoad"),
        )
        for day in days
    ]
