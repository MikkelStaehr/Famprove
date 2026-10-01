"""Analyse / Styrke: lifted status, program phase, e1RM from lifted kg and weekly rows.

Rules agreed with the user (2026-10-01):
- Lifted: a set's kg counts once its session is matched to an intervals.icu activity
  ("lifted"), or, in a block before the activity log (blok <= PRE_LOG_LAST_BLOCK), once its ISO
  week has ended ("pre_log"; a skipped session with pre-filled kg can't be told apart).
  Everything else is the plan ("planned") and never counts.
- Phase: PHASES names the first block of each phase; a later block inherits the latest phase
  (compute logs blocks past PHASES_CONFIRMED_TO, so the user can confirm or add a phase).
- e1RM, lifted kg only: kg x (1 + 0.0333 x (reps + 10 - RPE)), the sheet formula's own relation
  (planned_load's inverse), on competition-name sets with an RPE prescription and at most
  MAX_E1RM_REPS reps (no tempo/variants, no % rows, no -x% back-offs). RPE = the logged RPE
  (LSRPE) when the week has any for the lift, else the prescribed RPE (a range's midpoint).
  Week value = the best set; block best = the best week. Outside E1RM_BOUNDS_KG: not used.
- Tonnage: kg x reps over the lift type's lifted sets (variants included), as the sheet's
  TONNAGE.
- Weeks: one row per ISO week x lift from the first set's week to today's week; a week with
  nothing lifted is a real 0.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.planned_load import prescribed_rpe
from training_load.domain.strength import Block, StrengthSet, block_number, iso_week_start

type KgStatus = Literal["lifted", "pre_log", "planned"]
type Phase = Literal["in_season", "off_season"]
type RpeSource = Literal["logged", "prescribed"]
type SetKey = tuple[str, str, int, int, int]  # strength_sets' primary key

LIFTS: Final = ("SQUAT", "BENCH", "DEADLIFT")
COMPETITION_NAMES: Final[Mapping[str, frozenset[str]]] = {
    "SQUAT": frozenset({"squat"}),
    "BENCH": frozenset({"bænk", "bænkpres"}),
    "DEADLIFT": frozenset({"dødløft"}),
}
"""Lower-case exercise names that are the competition lift (e1RM). Variants such as
"3.2.0 Tempo squat" count in tonnage only."""

PRE_LOG_LAST_BLOCK: Final = 11
PHASES: Final[tuple[tuple[int, Phase], ...]] = ((1, "in_season"), (12, "off_season"))
"""(first block, phase), ascending: blok 11 and earlier in-season, from blok 12 off-season."""
PHASES_CONFIRMED_TO: Final = 12
"""The newest block whose phase the user confirmed; later blocks inherit and are logged."""

MAX_E1RM_REPS: Final = 8
E1RM_FACTOR: Final = 0.0333
E1RM_BOUNDS_KG: Final = (20.0, 400.0)


@dataclass(frozen=True, slots=True)
class StrengthWeek:
    week_start: date
    lift: str
    block: str | None
    block_no: int | None
    phase: Phase | None
    status: Literal["lifted", "pre_log"] | None  # None: nothing lifted
    sets_lifted: int
    tonnage_kg: float
    e1rm_kg: float | None
    e1rm_load_kg: float | None
    e1rm_reps: float | None
    e1rm_rpe: float | None
    e1rm_rpe_source: RpeSource | None
    is_block_best: bool


@dataclass(frozen=True, slots=True)
class StrengthAnalysis:
    weeks: list[StrengthWeek]
    e1rm_out_of_bounds: int  # candidate sets left out (implausible e1RM)


def set_key(s: StrengthSet) -> SetKey:
    return (s.sheet_id, s.block, s.sheet_row, s.week, s.set_no)


def phase_of(block_no: int) -> Phase:
    phase = PHASES[0][1]
    for first, name in PHASES:
        if block_no >= first:
            phase = name
    return phase


def kg_status(s: StrengthSet, *, done: bool, today: date) -> KgStatus:
    """``done``: the set's session is matched to an activity."""
    if done:
        return "lifted"
    week_ended = s.week_start + timedelta(days=6) < today
    if week_ended and block_number(s.block) <= PRE_LOG_LAST_BLOCK:
        return "pre_log"
    return "planned"


def kg_statuses(
    sets: Iterable[StrengthSet], done: set[tuple[date, int]], today: date
) -> dict[SetKey, KgStatus]:
    """``done``: (week_start, session) of every session matched to an activity."""
    return {
        set_key(s): kg_status(s, done=(s.week_start, s.session) in done, today=today) for s in sets
    }


def e1rm(kg: float, reps: float, rpe: float) -> float:
    return kg * (1 + E1RM_FACTOR * (reps + 10 - rpe))


def is_competition_lift(s: StrengthSet) -> bool:
    return s.name.strip().lower() in COMPETITION_NAMES.get(s.type, frozenset())


def _candidate(s: StrengthSet) -> bool:
    return (
        is_competition_lift(s)
        and s.reps <= MAX_E1RM_REPS
        and s.logged_kg is not None
        and s.logged_kg > 0
        and prescribed_rpe(s.prescribed) is not None  # an RPE top set: no %, no -x%
    )


def _block_of(week: date, blocks: Sequence[Block]) -> Block | None:
    for b in blocks:
        if b.start_date <= week <= (b.end_date or week):
            return b
    return None


def strength_weeks(
    sets: Sequence[StrengthSet],
    statuses: Mapping[SetKey, KgStatus],
    blocks: Sequence[Block],
    *,
    today: date,
) -> StrengthAnalysis:
    """Every ISO week x lift from the first set's week to today's week (empty without sets)."""
    if not sets:
        return StrengthAnalysis(weeks=[], e1rm_out_of_bounds=0)
    counted: dict[tuple[date, str], list[tuple[StrengthSet, KgStatus]]] = {}
    for s in sets:
        status = statuses[set_key(s)]
        if s.type in LIFTS and status != "planned" and s.logged_kg is not None:
            counted.setdefault((s.week_start, s.type), []).append((s, status))

    out_of_bounds = 0
    weeks: list[StrengthWeek] = []
    week = min(s.week_start for s in sets)
    while week <= iso_week_start(today):
        block = _block_of(week, blocks)
        for lift in LIFTS:
            lifted = counted.get((week, lift), [])
            best, dropped = _best_e1rm([s for s, _ in lifted if _candidate(s)])
            out_of_bounds += dropped
            statuses_here = {status for _, status in lifted}
            weeks.append(
                StrengthWeek(
                    week_start=week,
                    lift=lift,
                    block=block.name if block else None,
                    block_no=block.block_no if block else None,
                    phase=phase_of(block.block_no) if block else None,
                    status=(
                        "lifted"
                        if "lifted" in statuses_here
                        else "pre_log"
                        if "pre_log" in statuses_here
                        else None
                    ),
                    sets_lifted=len(lifted),
                    tonnage_kg=sum((s.logged_kg or 0.0) * s.reps for s, _ in lifted),
                    e1rm_kg=best[0] if best else None,
                    e1rm_load_kg=best[1] if best else None,
                    e1rm_reps=best[2] if best else None,
                    e1rm_rpe=best[3] if best else None,
                    e1rm_rpe_source=best[4] if best else None,
                    is_block_best=False,
                )
            )
        week += timedelta(days=7)
    return StrengthAnalysis(weeks=_mark_block_best(weeks), e1rm_out_of_bounds=out_of_bounds)


def _best_e1rm(
    candidates: Sequence[StrengthSet],
) -> tuple[tuple[float, float, float, float, RpeSource] | None, int]:
    """The best (e1rm, kg, reps, rpe, source) of the week's candidate sets, and how many were
    left out as implausible. Logged RPE wins when any candidate has one."""
    logged = [s for s in candidates if s.logged_rpe is not None]
    source: RpeSource = "logged" if logged else "prescribed"
    points: list[tuple[float, float, float, float, RpeSource]] = []
    for s in logged or candidates:
        rpe = s.logged_rpe if source == "logged" else prescribed_rpe(s.prescribed)
        assert rpe is not None and s.logged_kg is not None  # _candidate, the source split
        points.append((e1rm(s.logged_kg, s.reps, rpe), s.logged_kg, s.reps, rpe, source))
    low, high = E1RM_BOUNDS_KG
    plausible = [p for p in points if low <= p[0] <= high]
    return max(plausible, default=None, key=lambda p: p[0]), len(points) - len(plausible)


def _mark_block_best(weeks: list[StrengthWeek]) -> list[StrengthWeek]:
    best: dict[tuple[str, str], StrengthWeek] = {}
    for w in weeks:
        if w.block is None or w.e1rm_kg is None:
            continue
        current = best.get((w.block, w.lift))
        if current is None or w.e1rm_kg > (current.e1rm_kg or 0.0):  # ties: the earliest week
            best[(w.block, w.lift)] = w
    marked = {(w.week_start, w.lift) for w in best.values()}
    return [replace(w, is_block_best=(w.week_start, w.lift) in marked) for w in weeks]
