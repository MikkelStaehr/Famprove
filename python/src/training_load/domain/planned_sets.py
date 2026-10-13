"""Suggested kg per planned set, for the Træning screen (decided with the user 2026-10-12).

  suggested kg = rolling e1RM of the exercise's lift x pct(RPE, reps) x suggestion_scale,
                 rounded to ROUND_TO_KG

- The lift: the exercise's parent_lift in public.exercises (a main lift is its own parent).
- Rolling e1RM: the highest e1RM of a qualifying lifted set of that lift in the
  ROLLING_E1RM_WEEKS ISO weeks ending with the run day's week (one light week doesn't drag it
  down, an old peak doesn't linger). Qualifying (user, 2026-10-13): the competition lift, at most
  ROLLING_MAX_REPS reps and a prescribed RPE of at least ROLLING_MIN_RPE, because back-off and
  high-rep sets inflate the estimate (an 8-rep back-off at RPE 5-7 put bench at 110 kg against
  a top set of 85 x 3 @ 7). RPE = the set's logged RPE when present, else the prescribed one.
  /analyse keeps its own, wider rule (strength_analysis.MAX_E1RM_REPS) for the e1RM history.
- Weekly cap (user, 2026-10-13): against last week's logged kg for the same row (the same
  sheet row of the same block the week before, same exercise and reps: what Træning shows as
  "Sidste uge"), a suggestion rises at most CAP_UP_KG and falls at most CAP_DOWN_KG, both rounded
  inward to ROUND_TO_KG. The prescribed RPE may differ: the programme's own +0.5 a week must not
  bypass the cap (user, 2026-10-13). Reps must match: 3 reps are not capped by an 8-rep kg.
  A capped set keeps its uncapped suggestion in uncapped_kg (the web shows
  "(begrænset)"); None when the cap didn't apply or there is no such logged kg.
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
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.exercises import Catalog
from training_load.domain.planned_load import prescribed_rpe
from training_load.domain.strength import StrengthSet, iso_week_start
from training_load.domain.strength_analysis import (
    E1RM_BOUNDS_KG,
    E1RM_FACTOR,
    KgStatus,
    SetKey,
    e1rm,
    is_competition_lift,
    set_key,
)

ROLLING_E1RM_WEEKS: Final = 4
ROLLING_MAX_REPS: Final = 5
ROLLING_MIN_RPE: Final = 7.0
CAP_UP_KG: Final = 2.5
CAP_DOWN_KG: Final = 5.0
ROUND_TO_KG: Final = 2.5

type Basis = Literal["rpe_e1rm", "not_rpe", "no_e1rm", "no_lift"]


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


def pct_of_e1rm(reps: float, rpe: float) -> float:
    """The share of e1RM that reps at RPE take: the inverse of strength_analysis.e1rm."""
    return 1 / (1 + E1RM_FACTOR * (reps + 10 - rpe))


def round_to_step(kg: float, step: float = ROUND_TO_KG) -> float:
    """Nearest multiple of ``step``, halves up (141.25 -> 142.5), like the sheet's MROUND."""
    return math.floor(kg / step + 0.5) * step


def counts_for_rolling_e1rm(s: StrengthSet, status: KgStatus) -> bool:
    """A lifted competition-lift set of at most ROLLING_MAX_REPS reps at a prescribed RPE of at
    least ROLLING_MIN_RPE, with logged kg."""
    rpe = prescribed_rpe(s.prescribed)
    return (
        status != "planned"
        and is_competition_lift(s)
        and s.reps <= ROLLING_MAX_REPS
        and rpe is not None
        and rpe >= ROLLING_MIN_RPE
        and s.logged_kg is not None
        and s.logged_kg > 0
    )


def rolling_e1rm(
    sets: Iterable[StrengthSet], statuses: Mapping[SetKey, KgStatus], lift: str, run_week: date
) -> float | None:
    """The highest e1RM of ``lift``'s qualifying sets in the ROLLING_E1RM_WEEKS weeks ending with
    ``run_week`` (an ISO Monday); None when there is none. Implausible values are left out."""
    first = run_week - timedelta(weeks=ROLLING_E1RM_WEEKS - 1)
    low, high = E1RM_BOUNDS_KG
    values = []
    for s in sets:
        if s.type != lift or not first <= s.week_start <= run_week:
            continue
        if not counts_for_rolling_e1rm(s, statuses[set_key(s)]):
            continue
        rpe = s.logged_rpe if s.logged_rpe is not None else prescribed_rpe(s.prescribed)
        assert rpe is not None and s.logged_kg is not None  # counts_for_rolling_e1rm
        value = e1rm(s.logged_kg, s.reps, rpe)
        if low <= value <= high:
            values.append(value)
    return max(values, default=None)


def _step_up(kg: float) -> float:
    return math.ceil(kg / ROUND_TO_KG - 1e-9) * ROUND_TO_KG


def _step_down(kg: float) -> float:
    return math.floor(kg / ROUND_TO_KG + 1e-9) * ROUND_TO_KG


def weekly_cap(suggested: float, last_kg: float | None) -> tuple[float, float | None]:
    """(the suggestion within CAP_UP_KG / CAP_DOWN_KG of last week's kg, the uncapped
    suggestion when the cap changed it, else None)."""
    if last_kg is None:
        return suggested, None
    capped = min(max(suggested, _step_up(last_kg - CAP_DOWN_KG)), _step_down(last_kg + CAP_UP_KG))
    return (capped, suggested) if capped != suggested else (suggested, None)


def _same_exercise(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


def last_week_kg(
    sets: Iterable[StrengthSet], statuses: Mapping[SetKey, KgStatus]
) -> dict[tuple[str, int, date], StrengthSet]:
    """(block, sheet_row, week_start) -> the first set with logged kg of each lifted RPE row, as
    Træning's "Sidste uge" shows it. A session that wasn't lifted (pre-filled kg of a missed
    session) anchors nothing."""
    first: dict[tuple[str, int, date], StrengthSet] = {}
    for s in sets:
        if statuses[set_key(s)] == "planned" or s.logged_kg is None or s.logged_kg <= 0:
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
) -> list[PlannedSet]:
    """One PlannedSet per set of the run day's ISO week and later, in strength_sets order."""
    run_week = iso_week_start(today)
    e1rms = {
        lift: rolling_e1rm(sets, statuses, lift, run_week)
        for lift in ("SQUAT", "BENCH", "DEADLIFT")
    }
    logged = last_week_kg(sets, statuses)
    out: list[PlannedSet] = []
    for s in sets:
        if s.week_start < run_week:
            continue
        exercise = catalog.find(s.name)
        lift = exercise.parent_lift if exercise is not None else None
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
        uncapped = None
        if suggested is not None and suggested > 0:
            before = logged.get((s.block, s.sheet_row, s.week_start - timedelta(days=7)))
            same = (
                before is not None and _same_exercise(before.name, s.name) and before.reps == s.reps
            )
            anchor = before.logged_kg if same and before is not None else None
            suggested, uncapped = weekly_cap(suggested, anchor)
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
                suggested_kg=suggested if suggested is not None and suggested > 0 else None,
                basis=basis,
                uncapped_kg=uncapped,
            )
        )
    return out
