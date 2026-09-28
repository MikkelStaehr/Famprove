"""public.planned_sessions (read, user-filled) and public.planned_targets (derived, rebuilt)."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.plan import TargetItem, TargetStep
from training_load.narrow import opt_str, req_date, req_str

SESSIONS: Final = "planned_sessions"
TARGETS: Final = "planned_targets"


@dataclass(frozen=True, slots=True)
class PlannedSession:
    date: date
    name: str
    steps: object  # raw JSON; validated by domain.plan.parse_steps
    notes: str | None


@dataclass(frozen=True, slots=True)
class PlannedTarget:
    date: date
    name: str
    notes: str | None
    ftp: int | None
    total_minutes: float
    steps: tuple[TargetItem, ...]
    problem: str | None


class PlannedTargetRow(TypedDict):
    date: str
    name: str
    notes: str | None
    ftp: int | None
    total_minutes: float
    steps: list[dict[str, object]]
    problem: str | None
    computed_at: str


def all_sessions(db: Postgrest) -> list[PlannedSession]:
    rows = db.select(SESSIONS, columns="date,name,steps,notes", order="date,name")
    return [
        PlannedSession(
            date=req_date(r, "date"),
            name=req_str(r, "name"),
            steps=r.get("steps"),
            notes=opt_str(r, "notes"),
        )
        for r in rows
    ]


def _step_json(step: TargetStep) -> dict[str, object]:
    return {
        "kind": "step",
        "label": step.label,
        "minutes": step.minutes,
        "pct_low": step.pct_low,
        "pct_high": step.pct_high,
        "watts_low": step.watts_low,
        "watts_high": step.watts_high,
    }


def steps_json(items: Sequence[TargetItem]) -> list[dict[str, object]]:
    return [
        _step_json(item)
        if isinstance(item, TargetStep)
        else {"kind": "repeat", "repeat": item.repeat, "steps": [_step_json(s) for s in item.steps]}
        for item in items
    ]


def to_row(target: PlannedTarget, computed_at: datetime) -> PlannedTargetRow:
    return PlannedTargetRow(
        date=target.date.isoformat(),
        name=target.name,
        notes=target.notes,
        ftp=target.ftp,
        total_minutes=target.total_minutes,
        steps=steps_json(target.steps),
        problem=target.problem,
        computed_at=computed_at.isoformat(),
    )


def sync_targets(db: Postgrest, targets: Sequence[PlannedTarget], *, computed_at: datetime) -> int:
    """Upsert every target, then delete stored targets whose session no longer exists.

    Returns how many stale rows were deleted. ValueError if ``computed_at`` is naive.
    """
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if targets:
        db.upsert(TARGETS, [to_row(t, computed_at) for t in targets], on_conflict="date,name")
    keep = {(t.date.isoformat(), t.name) for t in targets}
    stored = db.select(TARGETS, columns="date,name", order="date,name")
    stale = sorted({(req_str(r, "date"), req_str(r, "name")) for r in stored} - keep)
    for day, name in stale:
        db.delete(TARGETS, [("date", f"eq.{day}"), ("name", f"eq.{name}")])
    return len(stale)
