"""Analyse / Styrke: lifted status, program phase, e1RM from lifted kg and weekly rows.

Rules agreed with the user (2026-10-01):
- Lifted: a set's kg counts once its session is matched to an intervals.icu activity
  ("lifted"), or, in a block before the activity log (blok <= PRE_LOG_LAST_BLOCK), once its ISO
  week has ended ("pre_log"; a skipped session with pre-filled kg can't be told apart).
  Everything else is the plan ("planned") and never counts.
- Phase: PHASES names the first block of each phase; a later block inherits the latest phase
  (compute logs blocks past PHASES_CONFIRMED_TO, so the user can confirm or add a phase).
- e1RM, one rule for Analyse > Styrke and the suggestions (user, 2026-10-14; e1rm_point owns
  it): kg x (1 + 0.0333 x (reps + 10 - RPE)), the sheet formula's own relation (planned_load's
  inverse), from lifted kg of a competition-name set (no tempo/variants) of at most
  E1RM_MAX_REPS reps at a prescribed RPE of at least E1RM_MIN_RPE (no % rows, no -x% back-offs,
  no high-rep or light sets: an 8-rep set at RPE 6 put bench at 110 kg against 85 x 3 @ 7).
  RPE = the set's logged RPE (LSRPE) when present, else the prescribed RPE (a range's
  midpoint). Week value = the best set; block best = the best week; the rolling e1RM (the
  suggestions, the %-row RPE estimate) = the best week of the ROLLING_E1RM_WEEKS ISO weeks
  ending with a week. Outside E1RM_BOUNDS_KG: not used. A week with no such set has no e1RM
  (None, never 0).
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
from training_load.sources.strength_sheet import E1RM_RANGE

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

E1RM_MAX_REPS: Final = 5
E1RM_MIN_RPE: Final = 7.0
"""The e1RM rule's set filter (user, 2026-10-13 for the suggestions, 2026-10-14 for /analyse):
reps <= E1RM_MAX_REPS at a prescribed RPE >= E1RM_MIN_RPE."""
ROLLING_E1RM_WEEKS: Final = 4
E1RM_FACTOR: Final = 0.0333
E1RM_BOUNDS_KG: Final[tuple[float, float]] = E1RM_RANGE  # the parser's 1RM bound


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
    # The rolling e1RM as of this week (the suggestions' number, by the one rule): the best weekly
    # e1RM of the lift in the ROLLING_E1RM_WEEKS ISO weeks ending here, and the week it comes from
    # (ties: the latest). None when no week in that window has one.
    rolling_e1rm_kg: float | None = None
    rolling_e1rm_week: date | None = None


@dataclass(frozen=True, slots=True)
class E1rmPoint:
    """One set's e1RM and the values behind it."""

    e1rm_kg: float
    kg: float  # logged kg
    reps: float
    rpe: float
    rpe_source: RpeSource


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


def e1rm_point(s: StrengthSet, status: KgStatus) -> E1rmPoint | None:
    """The one e1RM rule (module docstring): the set's e1RM when it counts, else None. Bounds
    are checked by best_e1rm, which counts what they leave out."""
    prescribed = prescribed_rpe(s.prescribed)  # None: no RPE cell (a % row, a -x% back-off)
    if (
        status == "planned"
        or not is_competition_lift(s)
        or s.reps > E1RM_MAX_REPS
        or prescribed is None
        or prescribed < E1RM_MIN_RPE
        or s.logged_kg is None
        or s.logged_kg <= 0
    ):
        return None
    source: RpeSource
    if s.logged_rpe is not None:
        rpe, source = s.logged_rpe, "logged"
    else:
        rpe, source = prescribed, "prescribed"
    return E1rmPoint(e1rm(s.logged_kg, s.reps, rpe), s.logged_kg, s.reps, rpe, source)


def best_e1rm(sets: Iterable[tuple[StrengthSet, KgStatus]]) -> tuple[E1rmPoint | None, int]:
    """The best plausible e1RM of the sets that count (ties: the first), and how many counting
    sets were left out as implausible (outside E1RM_BOUNDS_KG)."""
    low, high = E1RM_BOUNDS_KG
    best: E1rmPoint | None = None
    dropped = 0
    for s, status in sets:
        point = e1rm_point(s, status)
        if point is None:
            continue
        if not low <= point.e1rm_kg <= high:
            dropped += 1
        elif best is None or point.e1rm_kg > best.e1rm_kg:
            best = point
    return best, dropped


def rolling_e1rm_at(weeks: Iterable[StrengthWeek], lift: str, week_start: date) -> float | None:
    """The rolling e1RM: the best weekly e1RM of ``lift`` in the ROLLING_E1RM_WEEKS ISO weeks
    ending with ``week_start``; None when there is none."""
    first = week_start - timedelta(weeks=ROLLING_E1RM_WEEKS - 1)
    values = [
        w.e1rm_kg
        for w in weeks
        if w.lift == lift and w.e1rm_kg is not None and first <= w.week_start <= week_start
    ]
    return max(values, default=None)


def _block_of(week: date, blocks: Sequence[Block]) -> Block | None:
    """The latest block that started on or before ``week``. A block followed by a later one
    ends at its last filled week (the weeks between blocks have none); the newest block keeps
    the current week even before its first kg is entered."""
    started = [b for b in blocks if b.start_date <= week]
    if not started:
        return None
    block = max(started, key=lambda b: b.start_date)
    followed = any(b.start_date > block.start_date for b in blocks)
    if followed and block.end_date is not None and week > block.end_date:
        return None
    return block


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
            best, dropped = best_e1rm(lifted)
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
                    e1rm_kg=best.e1rm_kg if best else None,
                    e1rm_load_kg=best.kg if best else None,
                    e1rm_reps=best.reps if best else None,
                    e1rm_rpe=best.rpe if best else None,
                    e1rm_rpe_source=best.rpe_source if best else None,
                    is_block_best=False,
                )
            )
        week += timedelta(days=7)
    return StrengthAnalysis(
        weeks=_with_rolling(_mark_block_best(weeks)), e1rm_out_of_bounds=out_of_bounds
    )


def _with_rolling(weeks: list[StrengthWeek]) -> list[StrengthWeek]:
    """Each row's rolling e1RM (the value rolling_e1rm_at gives) and its source week."""
    out: list[StrengthWeek] = []
    for w in weeks:
        first = w.week_start - timedelta(weeks=ROLLING_E1RM_WEEKS - 1)
        window = [
            x
            for x in weeks
            if x.lift == w.lift and x.e1rm_kg is not None and first <= x.week_start <= w.week_start
        ]
        if not window:
            out.append(w)
            continue
        source = max(window, key=lambda x: (x.e1rm_kg or 0.0, x.week_start))
        out.append(replace(w, rolling_e1rm_kg=source.e1rm_kg, rolling_e1rm_week=source.week_start))
    return out


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
