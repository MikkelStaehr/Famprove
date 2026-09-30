"""Typed, fail-fast settings. Each CLI builds only the config it needs.

Sources, in priority order: real environment (GitHub Actions secrets) > repo-root
``.env.local`` (local runs). Every missing/invalid variable of a job is reported together
in one ``ConfigError``. Secret fields are excluded from ``repr`` so they never reach logs.
"""

import json
import math
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final

from dotenv import find_dotenv, load_dotenv

_DRIVE_ID: Final = re.compile(r"[A-Za-z0-9_-]{10,}")
_DRIVE_ID_IN_URL: Final = re.compile(r"/d/([A-Za-z0-9_-]{10,})")


class ConfigError(ValueError):
    """One or more required env vars are missing or invalid. Lists every problem, no values."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("invalid configuration: " + "; ".join(problems))
        self.problems = problems


@dataclass(frozen=True, slots=True)
class SupabaseSettings:
    url: str  # SUPABASE_URL, https://<ref>.supabase.co (no trailing slash, no /rest/v1)
    service_key: str = field(repr=False)  # SUPABASE_SERVICE_KEY: legacy JWT or sb_secret_...


@dataclass(frozen=True, slots=True)
class IntervalsSettings:
    api_key: str = field(repr=False)  # INTERVALS_API_KEY
    athlete_id: str  # INTERVALS_ATHLETE_ID, e.g. "i123456" ("0" = the key's own athlete)


@dataclass(frozen=True, slots=True)
class GoogleSettings:
    sheet_id: str  # GOOGLE_SHEET_ID (Drive file id)
    # GOOGLE_SERVICE_ACCOUNT_JSON parsed; every value of a service-account key file is a string.
    service_account_info: Mapping[str, str] = field(repr=False)


@dataclass(frozen=True, slots=True)
class CollectIntervalsConfig:
    intervals: IntervalsSettings
    supabase: SupabaseSettings


@dataclass(frozen=True, slots=True)
class CollectStrengthConfig:
    google: GoogleSettings
    supabase: SupabaseSettings
    bodyweight: float  # BODYWEIGHT, kg, added to bodyweight exercises


@dataclass(frozen=True, slots=True)
class ComputeConfig:
    supabase: SupabaseSettings
    strength_k: float  # STRENGTH_K, multiplies the raw per-set score


def load_dotenv_file() -> None:
    """Load repo-root ``.env.local`` if one is found, without overriding real env vars.

    ``find_dotenv(".env.local", usecwd=True)`` then ``load_dotenv(path, override=False)``.
    Only call ``load_dotenv`` when a path was found: with an empty path python-dotenv falls
    back to searching for a plain ``.env``.
    """
    path = find_dotenv(".env.local", usecwd=True)
    if path:
        load_dotenv(path, override=False)


def mask_in_ci(*values: str) -> None:
    """In GitHub Actions, hide derived identifiers in the (public) job log for the rest of the
    job. Secrets are masked by GitHub already, but only as the exact secret string: a sheet id
    extracted from a pasted URL, or a field inside a JSON secret, would otherwise print."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for value in values:
            # One mask per line: ::add-mask:: only covers the first line of a multi-line value.
            for line in value.splitlines():
                if line.strip():
                    print(f"::add-mask::{line}", flush=True)


class _Reader:
    """Collects every problem instead of stopping at the first; messages never hold values."""

    def __init__(self, env: Mapping[str, str]) -> None:
        self._env = env
        self.problems: list[str] = []

    def text(self, name: str) -> str:
        value = self._env.get(name, "").strip()
        if not value:
            self.problems.append(f"{name} is missing")
        return value

    def number(self, name: str, *, above: float, below: float | None = None) -> float:
        raw = self.text(name)
        if not raw:
            return 0.0
        try:
            value = float(raw)
        except ValueError:
            hint = " (use a decimal point, not a comma)" if _decimal_comma(raw) else ""
            self.problems.append(f"{name} must be a number{hint}")
            return 0.0
        if not math.isfinite(value) or value <= above or (below is not None and value >= below):
            bounds = f"> {above}" + (f" and < {below}" if below is not None else "")
            self.problems.append(f"{name} must be {bounds}")
        return value

    def drive_file_id(self, name: str) -> str:
        """A bare Drive file id, or the id inside a pasted docs.google.com/.../d/<id>/... URL."""
        raw = self.text(name)
        match = _DRIVE_ID_IN_URL.search(raw) if "/" in raw else None
        file_id = match.group(1) if match else raw
        if raw and not _DRIVE_ID.fullmatch(file_id):
            self.problems.append(f"{name} must be a Google Sheet id or its URL")
        return file_id

    def supabase(self) -> SupabaseSettings:
        url = self.text("SUPABASE_URL").rstrip("/")
        if url and not url.startswith("https://"):
            self.problems.append("SUPABASE_URL must start with https://")
        return SupabaseSettings(url=url, service_key=self.text("SUPABASE_SERVICE_KEY"))

    def service_account(self, name: str) -> Mapping[str, str]:
        raw = self.text(name)
        if not raw:
            return {}
        try:
            parsed: object = json.loads(raw)
        except json.JSONDecodeError, RecursionError:
            quoted = raw[0] in "'\"" and raw[-1] == raw[0]
            hint = (
                " (remove the quotes around it: they belong in .env.local only)" if quoted else ""
            )
            self.problems.append(f"{name} is not valid JSON{hint}")
            return {}
        if not isinstance(parsed, dict) or parsed.get("type") != "service_account":
            self.problems.append(f"{name} must be a service-account key (type service_account)")
            return {}
        info = {k: v for k, v in parsed.items() if isinstance(k, str) and isinstance(v, str)}
        for required in ("client_email", "private_key"):
            if not info.get(required):
                self.problems.append(f"{name} has no {required}")
        return info

    def done(self) -> None:
        if self.problems:
            raise ConfigError(self.problems)


def _decimal_comma(raw: str) -> bool:
    """True for "0,10": a number with a decimal comma instead of a point."""
    try:
        float(raw.replace(",", ".", 1))
    except ValueError:
        return False
    return "," in raw


def collect_intervals_config(env: Mapping[str, str]) -> CollectIntervalsConfig:
    """Needs INTERVALS_API_KEY, INTERVALS_ATHLETE_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY."""
    r = _Reader(env)
    config = CollectIntervalsConfig(
        intervals=IntervalsSettings(
            api_key=r.text("INTERVALS_API_KEY"), athlete_id=r.text("INTERVALS_ATHLETE_ID")
        ),
        supabase=r.supabase(),
    )
    r.done()
    return config


def collect_strength_config(env: Mapping[str, str]) -> CollectStrengthConfig:
    """Needs GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, SUPABASE_URL, SUPABASE_SERVICE_KEY,
    BODYWEIGHT.

    GOOGLE_SERVICE_ACCOUNT_JSON must parse to a JSON object with type == "service_account",
    client_email and private_key. BODYWEIGHT must be a finite float in (0, 300).
    """
    r = _Reader(env)
    config = CollectStrengthConfig(
        google=GoogleSettings(
            sheet_id=r.drive_file_id("GOOGLE_SHEET_ID"),
            service_account_info=r.service_account("GOOGLE_SERVICE_ACCOUNT_JSON"),
        ),
        supabase=r.supabase(),
        bodyweight=r.number("BODYWEIGHT", above=0, below=300),
    )
    r.done()
    return config


def all_problems(env: Mapping[str, str]) -> list[str]:
    """Every problem of every job's configuration at once, each listed once, in job order.

    Used by ``check-config`` as the daily workflow's first step, so one run shows all mistakes
    (names and reasons only, never values) instead of one failing step per run.
    """
    problems: list[str] = []
    # A new job or secret goes in three places: its builder here, its step in daily.yml, and
    # the check-config step's env block there.
    for build in (collect_intervals_config, collect_strength_config, compute_config):
        try:
            build(env)
        except ConfigError as exc:
            problems.extend(p for p in exc.problems if p not in problems)
    return problems


def compute_config(env: Mapping[str, str]) -> ComputeConfig:
    """Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, STRENGTH_K (finite float > 0)."""
    r = _Reader(env)
    config = ComputeConfig(supabase=r.supabase(), strength_k=r.number("STRENGTH_K", above=0))
    r.done()
    return config
