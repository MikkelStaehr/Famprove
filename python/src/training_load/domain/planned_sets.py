"""Suggested kg per planned set, for the Træning screen (decided with the user 2026-10-12).

  suggested kg = rolling e1RM of the exercise's lift x pct(RPE, reps) x suggestion_scale,
                 rounded to ROUND_TO_KG

- The lift: the exercise's parent_lift in public.exercises (a main lift is its own parent).
- Rolling e1RM: the highest e1RM of that lift in the ROLLING_E1RM_WEEKS ISO weeks ending with
  the run day's week (one light week doesn't drag it down, an old peak doesn't linger), by the
  one e1RM rule /analyse uses too (strength_analysis.e1rm_point, user 2026-10-13/14: lifted
  competition-lift sets of at most E1RM_MAX_REPS reps at a prescribed RPE of at least
  E1RM_MIN_RPE; RPE = the set's logged RPE when present, else the prescribed one). It equals
  the best weekly e1RM Analyse > Styrke shows in those weeks.
- Weekly cap (user, 2026-10-13): against last week's logged kg for the same row (the same
  sheet row of the same block the week before, same exercise and reps: what Træning shows as
  "Sidste uge"), a suggestion rises at most CAP_UPPER_KG for an upper-body exercise and
  CAP_LOWER_KG for a lower-body one (the sheet's TYPE, LOWER_BODY_WORDS), rounded down to
  ROUND_TO_KG; it may fall freely ("+2.5 kg (upper) / +5 kg (lower)"). The prescribed RPE may
  differ: the programme's own +0.5 a week must not bypass the cap. Reps must match: 3 reps are
  not capped by an 8-rep kg. A capped set keeps its uncapped suggestion in uncapped_kg (the web
  shows "(begrænset)"); None when the cap didn't apply or there is no such logged kg.
- pct(RPE, reps) = 1 / (1 + E1RM_FACTOR x (reps + 10 - RPE)): the relation /analyse uses to get an
  e1RM from a lifted set, so a suggestion is its exact inverse. The coach's sheet has no RPE table
  (checked 2026-10-12: Home has an RPE word scale; the only 1RM formula is Brzycki, without RPE).
- RPE: the prescribed RPE, the mid of a range ("RPE 5 - 7" -> 6); an RPE cell that isn't whole or
  half values is never used. Reps: the set's reps, the mid of a range ("8 - 12" -> 10).
- suggestion_scale: the exercise's multiplier in public.exercises (1.0; tempo variants 0.8, as
  they inherit the competition lift's e1RM: about 20 % too heavy on 2026-10-12 data).
- No suggestion is null, never 0, and `basis` says why: not_rpe (e.g. "-12.5%" or no load cell),
  no_lift (no parent lift: an accessory, or a name the catalogue doesn't know), no_e1rm (no e1RM
  for that lift in the window).
Only the run day's ISO week and later get rows: past weeks were lifted with what the sheet says.
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.exercises import Catalog, Exercise
from training_load.domain.planned_load import prescribed_rpe
from training_load.domain.set_feedback import Progression
from training_load.domain.strength import StrengthSet, iso_week_start
from training_load.domain.strength_analysis import (
    E1RM_FACTOR,
    ROLLING_E1RM_WEEKS,
    KgStatus,
    SetKey,
    best_e1rm,
    counts,
    set_key,
)
from training_load.domain.today_kg import TodayBasis, today_kgs

CAP_UPPER_KG: Final = 2.5
CAP_LOWER_KG: Final = 5.0
LOWER_BODY_WORDS: Final = (
    "SQUAT",
    "DEADLIFT",
    "QUADS",
    "HAMSTRINGS",
    "GLUTES",
    "ADDUCTORS",
    "CALVES",
)
"""A sheet TYPE (e.g. "QUADS/ADDUCTORS", "HAMSTRINGS") with any of these words is lower body;
every other type (BENCH, CHEST/SHOULDERS, LATS/MIDDLE BACK, ...) is upper body."""
ROUND_TO_KG: Final = 2.5

type Basis = Literal["rpe_e1rm", "not_rpe", "no_e1rm", "no_lift", "progression", "new_variant"]

REST_MAIN_S: Final = (180, 300)
REST_OTHER_S: Final = (90, 180)
REST_SHORT_S: Final = (60, 120)
"""Recommended rest after a set, by the exercise's type only (user, 2026-10-15, slice
rest-by-type; was reps <= 5 at RPE >= 7 since 2026-10-13): a main lift or its variant (catalogue
category main, or a parent lift, e.g. "3.0.0 Tempo squat") 3-5 min; isolation and abs 1-2 min;
every other exercise (accessory, bodyweight, a name not in the catalogue) 1.5-3 min."""
RAMP: Final = ((40, 5), (60, 3), (80, 2))
"""The warm-up ramp before a main lift: (% of the first working set's kg, reps)."""


@dataclass(frozen=True, slots=True)
class RampStep:
    pct: int
    reps: int
    kg: float  # a multiple of ROUND_TO_KG, > 0


@dataclass(frozen=True, slots=True)
class PlannedSet:
    """Mirrors a public.planned_sets row (key = the strength_sets key)."""

    sheet_id: str
    block: str
    sheet_row: int
    week: int
    set_no: int
    week_start: date
    session: int
    exercise_id: int | None  # None: the sheet name is not in public.exercises
    e1rm_lift: str | None  # the lift whose e1RM was used (the exercise's parent_lift)
    e1rm_kg: float | None  # the rolling e1RM used
    rpe: float | None  # the prescribed RPE (mid of a range); None when not RPE-based
    reps: float  # the reps used (mid of a range)
    pct: float | None  # 1 / (1 + E1RM_FACTOR x (reps + 10 - RPE))
    suggested_kg: float | None  # a multiple of ROUND_TO_KG; None: no suggestion (see basis)
    basis: Basis
    uncapped_kg: float | None = None  # the suggestion before the weekly cap; None: not capped
    adjustment_kg: float | None = None  # a progression step (2.5 / 5) or 0 for hold; None: none
    adjustment_reason: str | None = None  # Danish; None exactly when adjustment_kg is None
    rest_min_s: int | None = None  # recommended rest after this set
    rest_max_s: int | None = None
    ramp: tuple[RampStep, ...] | None = None  # main lifts, a run's first set; None: no ramp
    rpe_kg: float | None = None  # the e1RM x RPE suggestion before adjustment and cap (not stored)
    variant_id: int | None = None  # the set's exercise variant (not stored; 2026-10-14)
    # Fokus's "I DAG" figure (domain.today_kg, slice fokus-kg); both None: no kg to show.
    today_kg: float | None = None
    today_basis: TodayBasis | None = None


def pct_of_e1rm(reps: float, rpe: float) -> float:
    """The share of e1RM that reps at RPE take: the inverse of strength_analysis.e1rm."""
    return 1 / (1 + E1RM_FACTOR * (reps + 10 - rpe))


def round_to_step(kg: float, step: float = ROUND_TO_KG) -> float:
    """Nearest multiple of ``step``, halves up (141.25 -> 142.5), like the sheet's MROUND."""
    return math.floor(kg / step + 0.5) * step


def rolling_e1rm(
    sets: Iterable[StrengthSet], statuses: Mapping[SetKey, KgStatus], lift: str, run_week: date
) -> float | None:
    """The highest e1RM of ``lift``'s sets in the ROLLING_E1RM_WEEKS weeks ending with
    ``run_week`` (an ISO Monday), by strength_analysis.e1rm_point; None when there is none.
    Implausible values are left out."""
    first = run_week - timedelta(weeks=ROLLING_E1RM_WEEKS - 1)
    best, _ = best_e1rm(
        (s, statuses[set_key(s)])
        for s in sets
        if s.type == lift and first <= s.week_start <= run_week
    )
    return best.e1rm_kg if best is not None else None


def _step_down(kg: float) -> float:
    return math.floor(kg / ROUND_TO_KG + 1e-9) * ROUND_TO_KG


def is_lower_body(sheet_type: str) -> bool:
    words = sheet_type.upper().replace("/", " ").split()
    return any(w in LOWER_BODY_WORDS for w in words)


def cap_kg(sheet_type: str) -> float:
    """How much a suggestion may rise in a week: CAP_LOWER_KG or CAP_UPPER_KG."""
    return CAP_LOWER_KG if is_lower_body(sheet_type) else CAP_UPPER_KG


def weekly_cap(suggested: float, last_kg: float | None, up_kg: float) -> tuple[float, float | None]:
    """(the suggestion at most ``up_kg`` above last week's kg, rounded down to the grid; the
    uncapped suggestion when the cap lowered it, else None)."""
    if last_kg is None:
        return suggested, None
    capped = min(suggested, _step_down(last_kg + up_kg))
    return (capped, suggested) if capped != suggested else (suggested, None)


def _same_exercise(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


def _same_reps(a: StrengthSet, b: StrengthSet) -> bool:
    """The same prescribed reps: the sheet's text ("8 - 12"), since a done range set's reps are
    the reps done (domain.set_feedback)."""
    if a.reps_text is not None and b.reps_text is not None:
        return a.reps_text.strip() == b.reps_text.strip()
    return a.reps == b.reps


def is_main_lift(exercise: Exercise | None) -> bool:
    """A main lift or one of its variants: category main, or a parent lift (tempo variants are
    category accessory with a parent lift)."""
    return exercise is not None and (
        exercise.category == "main" or exercise.parent_lift is not None
    )


def rest_band(exercise: Exercise | None) -> tuple[int, int]:
    """The rest window after a set of ``exercise`` (REST_*_S)."""
    if is_main_lift(exercise):
        return REST_MAIN_S
    if exercise is not None and exercise.category in ("isolation", "abs"):
        return REST_SHORT_S
    return REST_OTHER_S


def ramp_of(base_kg: float) -> tuple[RampStep, ...] | None:
    """40/60/80 % of ``base_kg`` for 5/3/2 reps, rounded to ROUND_TO_KG; None when a step would
    round to 0 (a base too light to ramp)."""
    steps = tuple(RampStep(pct, reps, round_to_step(base_kg * pct / 100)) for pct, reps in RAMP)
    return steps if all(step.kg > 0 for step in steps) else None


def last_week_kg(
    sets: Iterable[StrengthSet], statuses: Mapping[SetKey, KgStatus]
) -> dict[tuple[str, int, date], StrengthSet]:
    """(block, sheet_row, week_start) -> the first set with logged kg of each lifted RPE row, as
    Træning's "Sidste uge" shows it. A session that wasn't lifted (pre-filled kg of a missed
    session) anchors nothing."""
    first: dict[tuple[str, int, date], StrengthSet] = {}
    for s in sets:
        if not counts(statuses[set_key(s)]) or s.logged_kg is None or s.logged_kg <= 0:
            continue
        key = (s.block, s.sheet_row, s.week_start)
        if key not in first or s.set_no < first[key].set_no:
            first[key] = s
    return {key: s for key, s in first.items() if prescribed_rpe(s.prescribed) is not None}


def planned_sets(
    sets: Sequence[StrengthSet],
    catalog: Catalog,
    statuses: Mapping[SetKey, KgStatus],
    *,
    today: date,
    progressions: Mapping[tuple[int, int | None], Progression] | None = None,
) -> list[PlannedSet]:
    """One PlannedSet per set of the run day's ISO week and later, in strength_sets order.
    ``progressions`` (domain.set_feedback, by exercise id): a step up or a hold, applied before
    the weekly cap. An exercise without an e1RM suggestion (no_lift, no_e1rm) gets last week's
    kg plus the step (or held) as a "progression" suggestion when a rule fires."""
    rules = progressions or {}
    run_week = iso_week_start(today)
    e1rms = {
        lift: rolling_e1rm(sets, statuses, lift, run_week)
        for lift in ("SQUAT", "BENCH", "DEADLIFT")
    }
    logged = last_week_kg(sets, statuses)
    out: list[PlannedSet] = []
    anchors: dict[SetKey, float] = {}
    for s in sets:
        if s.week_start < run_week:
            continue
        exercise = catalog.find(s.name)
        # A named variant (user, 2026-10-14) is not the competition lift: no e1RM suggestion,
        # progression only, from its own last week.
        lift = exercise.parent_lift if exercise is not None and s.variant_id is None else None
        rpe = prescribed_rpe(s.prescribed)
        e1rm_kg = e1rms.get(lift) if lift is not None else None
        pct = pct_of_e1rm(s.reps, rpe) if rpe is not None else None
        basis: Basis
        if rpe is None:
            basis = "not_rpe"
        elif lift is None:
            basis = "no_lift"
        elif e1rm_kg is None:
            basis = "no_e1rm"
        else:
            basis = "rpe_e1rm"
        scale = exercise.suggestion_scale if exercise is not None else 1.0
        suggested = (
            round_to_step(e1rm_kg * pct * scale)
            if basis == "rpe_e1rm" and e1rm_kg is not None and pct is not None
            else None
        )
        if suggested is not None and suggested <= 0:
            suggested = None
        rpe_kg = suggested
        before = logged.get((s.block, s.sheet_row, s.week_start - timedelta(days=7)))
        same = (
            before is not None
            and _same_exercise(before.name, s.name)
            and _same_reps(before, s)
            and before.variant_id == s.variant_id  # None matches only None
        )
        anchor = before.logged_kg if same and before is not None else None
        if anchor is not None:
            anchors[set_key(s)] = anchor
        step = cap_kg(s.type)
        rule = rules.get((exercise.id, s.variant_id)) if exercise is not None else None
        adjustment: float | None = None
        if rule is not None and suggested is not None:
            if rule.kind == "step":
                suggested, adjustment = suggested + step, step
            else:
                adjustment = 0.0
                if anchor is not None and _step_down(anchor) > 0:  # never 0 (suggested_kg > 0)
                    suggested = min(suggested, _step_down(anchor))
        elif rule is not None and basis in ("no_lift", "no_e1rm") and anchor is not None:
            basis = "progression"
            adjustment = step if rule.kind == "step" else 0.0
            suggested = _step_down(anchor + adjustment)
            if suggested <= 0:
                suggested, adjustment, basis = None, None, "no_lift" if lift is None else "no_e1rm"
        if s.variant_id is not None and anchor is None:
            # A variant with nothing logged last week: no suggestion until there is data.
            suggested, adjustment, basis = None, None, "new_variant"
        variant = catalog.variant_by_id(s.variant_id)
        if variant is not None and not variant.suggests:
            suggested, adjustment = None, None
            if basis == "progression":
                basis = "no_lift" if lift is None else "no_e1rm"
        uncapped = None
        if suggested is not None:
            suggested, uncapped = weekly_cap(suggested, anchor, step)
        rest_min, rest_max = rest_band(exercise)
        out.append(
            PlannedSet(
                sheet_id=s.sheet_id,
                block=s.block,
                sheet_row=s.sheet_row,
                week=s.week,
                set_no=s.set_no,
                week_start=s.week_start,
                session=s.session,
                exercise_id=exercise.id if exercise is not None else None,
                e1rm_lift=lift,
                e1rm_kg=e1rm_kg if basis == "rpe_e1rm" else None,
                rpe=rpe,
                reps=s.reps,
                pct=pct,
                suggested_kg=suggested,
                basis=basis,
                uncapped_kg=uncapped,
                adjustment_kg=adjustment,
                adjustment_reason=rule.reason
                if adjustment is not None and rule is not None
                else None,
                rest_min_s=rest_min,
                rest_max_s=rest_max,
                rpe_kg=rpe_kg,
                variant_id=s.variant_id,
            )
        )
    # Fokus's "I DAG": the sheet's kg, else derived from a sibling set, ~e1RM, last week's.
    today_by_ref = today_kgs(
        sets,
        {(p.sheet_id, p.block, p.sheet_row, p.set_no, p.week_start): p.suggested_kg for p in out},
        run_week=run_week,
        statuses=statuses,
    )
    out = [
        replace(p, today_kg=t.kg, today_basis=t.basis)
        if (t := today_by_ref.get((p.sheet_id, p.block, p.sheet_row, p.set_no, p.week_start)))
        is not None
        else p
        for p in out
    ]
    return _with_ramps(out, sets, catalog, anchors)


def _with_ramps(
    planned: list[PlannedSet],
    sets: Sequence[StrengthSet],
    catalog: Catalog,
    anchors: Mapping[SetKey, float],
) -> list[PlannedSet]:
    """The warm-up ramp on set 1 of the first row of each run of a main lift (consecutive rows
    with the same exercise in a session), from its suggestion, else last week's logged kg."""
    names = {set_key(s): s.name for s in sets}
    by_session: dict[tuple[date, int], list[PlannedSet]] = {}
    for p in planned:
        by_session.setdefault((p.week_start, p.session), []).append(p)
    ramps: dict[int, tuple[RampStep, ...]] = {}
    index = {id(p): i for i, p in enumerate(planned)}
    for rows in by_session.values():
        previous: str | None = None
        for p in sorted(rows, key=lambda p: (p.sheet_row, p.set_no)):
            key = (p.sheet_id, p.block, p.sheet_row, p.week, p.set_no)
            name = names[key].strip().casefold()
            starts_run = p.set_no == 1 and name != previous
            if p.set_no == 1:
                previous = name
            exercise = catalog.find(names[key])
            if not starts_run or exercise is None or exercise.category != "main":
                continue
            base = p.suggested_kg if p.suggested_kg is not None else anchors.get(key)
            ramp = ramp_of(base) if base is not None else None
            if ramp is not None:
                ramps[index[id(p)]] = ramp
    return [replace(p, ramp=ramps[i]) if i in ramps else p for i, p in enumerate(planned)]


def suggestion_offsets(planned: Sequence[PlannedSet]) -> dict[tuple[int, int | None], float | None]:
    """Per (exercise, variant): how far its next suggestion lies from the kg the coach's RPE
    gives (suggested - rpe_kg on its first RPE-based planned set); None when it has none."""
    out: dict[tuple[int, int | None], float | None] = {}
    for p in sorted(planned, key=lambda p: (p.week_start, p.session, p.sheet_row, p.set_no)):
        key = (p.exercise_id, p.variant_id) if p.exercise_id is not None else None
        if key is None or key in out:
            continue
        if p.suggested_kg is not None and p.rpe_kg is not None:
            out[key] = round(p.suggested_kg - p.rpe_kg, 1)
    return out
