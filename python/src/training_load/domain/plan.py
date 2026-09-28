"""Planned rides: validate the hand-written ``planned_sessions.steps`` and derive watt targets.

The single owner of target watts (Python owns every number). Input format, per item:

    step    {"label": "Warm-up", "minutes": 10, "pct_ftp": 55}      pct_ftp may be [50, 75]
    repeat  {"repeat": 4, "steps": [step, step, ...]}              one level of nesting

``watts = round(pct_ftp / 100 * ftp)``; with no FTP the watts are None. Errors are
``PlanError`` with a plain-words message the Today screen shows as-is.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

MAX_PCT_FTP: Final = 300.0
"""Sanity bound: a typo like 950 (instead of 95) is rejected rather than shown as 2375 W."""


class PlanError(ValueError):
    """The planned session's steps can't be used. The message is shown to the user."""


@dataclass(frozen=True, slots=True)
class Step:
    label: str | None
    minutes: float
    pct_low: float
    pct_high: float  # == pct_low for a single target


@dataclass(frozen=True, slots=True)
class Repeat:
    repeat: int
    steps: tuple[Step, ...]


type PlanItem = Step | Repeat


@dataclass(frozen=True, slots=True)
class TargetStep:
    label: str | None
    minutes: float
    pct_low: float
    pct_high: float
    watts_low: int | None
    watts_high: int | None


@dataclass(frozen=True, slots=True)
class TargetRepeat:
    repeat: int
    steps: tuple[TargetStep, ...]


type TargetItem = TargetStep | TargetRepeat


def _number(value: object, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise PlanError(f"{what} must be a number")
    return float(value)


def _step(raw: Mapping[str, object], where: str) -> Step:
    unknown = set(raw) - {"label", "minutes", "pct_ftp"}
    if unknown:
        raise PlanError(f"{where}: unknown field {sorted(unknown)[0]!r}")
    label = raw.get("label")
    if label is not None and not isinstance(label, str):
        raise PlanError(f"{where}: label must be text")
    minutes = _number(raw.get("minutes"), f"{where}: minutes")
    if not 0 < minutes <= 600:
        raise PlanError(f"{where}: minutes must be between 0 and 600")
    pct = raw.get("pct_ftp")
    if isinstance(pct, list):
        if len(pct) != 2:
            raise PlanError(f"{where}: pct_ftp range must be [low, high]")
        low, high = (_number(v, f"{where}: pct_ftp") for v in pct)
    else:
        low = high = _number(pct, f"{where}: pct_ftp")
    if not 0 < low <= high <= MAX_PCT_FTP:
        raise PlanError(
            f"{where}: pct_ftp must be above 0 and at most {MAX_PCT_FTP:g}, low before high"
        )
    clean_label = (label.strip() or None) if label else None
    return Step(label=clean_label, minutes=minutes, pct_low=low, pct_high=high)


def parse_steps(raw: object) -> tuple[PlanItem, ...]:
    """Validate the JSON from planned_sessions.steps. PlanError on anything unusable."""
    if not isinstance(raw, list) or not raw:
        raise PlanError("steps must be a non-empty list")
    items: list[PlanItem] = []
    for i, item in enumerate(raw, start=1):
        where = f"step {i}"
        if not isinstance(item, dict):
            raise PlanError(f"{where}: must be an object")
        if "repeat" not in item:
            items.append(_step(item, where))
            continue
        if set(item) != {"repeat", "steps"}:
            raise PlanError(f"{where}: a repeat has exactly 'repeat' and 'steps'")
        count = item["repeat"]
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 50:
            raise PlanError(f"{where}: repeat must be a whole number from 1 to 50")
        inner = item["steps"]
        if not isinstance(inner, list) or not inner:
            raise PlanError(f"{where}: a repeat needs a non-empty steps list")
        steps: list[Step] = []
        for j, sub in enumerate(inner, start=1):
            if not isinstance(sub, dict) or "repeat" in sub:
                raise PlanError(f"{where}.{j}: must be a plain step (repeats don't nest)")
            steps.append(_step(sub, f"{where}.{j}"))
        items.append(Repeat(repeat=count, steps=tuple(steps)))
    return tuple(items)


def _watts(pct: float, ftp: int | None) -> int | None:
    return None if ftp is None else round(pct / 100 * ftp)


def _target(step: Step, ftp: int | None) -> TargetStep:
    return TargetStep(
        label=step.label,
        minutes=step.minutes,
        pct_low=step.pct_low,
        pct_high=step.pct_high,
        watts_low=_watts(step.pct_low, ftp),
        watts_high=_watts(step.pct_high, ftp),
    )


def targets(items: Sequence[PlanItem], ftp: int | None) -> tuple[TargetItem, ...]:
    """Watt targets for every step, structure preserved."""
    return tuple(
        _target(item, ftp)
        if isinstance(item, Step)
        else TargetRepeat(repeat=item.repeat, steps=tuple(_target(s, ftp) for s in item.steps))
        for item in items
    )


def total_minutes(items: Sequence[PlanItem]) -> float:
    """Session length: steps once, repeat groups ``repeat`` times."""
    return sum(
        item.minutes if isinstance(item, Step) else item.repeat * sum(s.minutes for s in item.steps)
        for item in items
    )
