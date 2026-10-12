"""Suggested kg per planned set, for the Træning screen (decided with the user 2026-10-12).

  suggested kg = rolling e1RM of the exercise's lift x pct(RPE, reps), rounded to ROUND_TO_KG

- The lift: the exercise's parent_lift in public.exercises (a main lift is its own parent).
- Rolling e1RM: the highest weekly best e1RM (strength_weeks, the numbers /analyse shows) of that
  lift in the ROLLING_E1RM_WEEKS ISO weeks ending with the run day's week: one light week doesn't
  drag it down, an old peak doesn't linger.
- pct(RPE, reps) = 1 / (1 + E1RM_FACTOR x (reps + 10 - RPE)): the relation /analyse uses to get an
  e1RM from a lifted set, so a suggestion is its exact inverse. The coach's sheet has no RPE table
  (checked 2026-10-12: Home has an RPE word scale; the only 1RM formula is Brzycki, without RPE).
- RPE: the prescribed RPE, the mid of a range ("RPE 5 - 7" -> 6); an RPE cell that isn't whole or
  half values is never used. Reps: the set's reps, the mid of a range ("8 - 12" -> 10).
- No suggestion is null, never 0, and `basis` says why: not_rpe (e.g. "-12.5%" or no load cell),
  no_lift (no parent lift: an accessory, or a name the catalogue doesn't know), no_e1rm (no e1RM
  for that lift in the window).
Only the run day's ISO week and later get rows: past weeks were lifted with what the sheet says.
"""

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.exercises import Catalog
from training_load.domain.planned_load import prescribed_rpe
from training_load.domain.strength import StrengthSet, iso_week_start
from training_load.domain.strength_analysis import E1RM_FACTOR, StrengthWeek

ROLLING_E1RM_WEEKS: Final = 4
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


def pct_of_e1rm(reps: float, rpe: float) -> float:
    """The share of e1RM that reps at RPE take: the inverse of strength_analysis.e1rm."""
    return 1 / (1 + E1RM_FACTOR * (reps + 10 - rpe))


def round_to_step(kg: float, step: float = ROUND_TO_KG) -> float:
    """Nearest multiple of ``step``, halves up (141.25 -> 142.5), like the sheet's MROUND."""
    return math.floor(kg / step + 0.5) * step


def rolling_e1rm(weeks: Iterable[StrengthWeek], lift: str, run_week: date) -> float | None:
    """The highest weekly best e1RM of ``lift`` in the ROLLING_E1RM_WEEKS weeks ending with
    ``run_week`` (an ISO Monday); None when there is none."""
    first = run_week - timedelta(weeks=ROLLING_E1RM_WEEKS - 1)
    values = [
        w.e1rm_kg
        for w in weeks
        if w.lift == lift and w.e1rm_kg is not None and first <= w.week_start <= run_week
    ]
    return max(values, default=None)


def planned_sets(
    sets: Sequence[StrengthSet],
    catalog: Catalog,
    weeks: Sequence[StrengthWeek],
    *,
    today: date,
) -> list[PlannedSet]:
    """One PlannedSet per set of the run day's ISO week and later, in strength_sets order."""
    run_week = iso_week_start(today)
    e1rms = {lift: rolling_e1rm(weeks, lift, run_week) for lift in ("SQUAT", "BENCH", "DEADLIFT")}
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
        suggested = (
            round_to_step(e1rm_kg * pct)
            if basis == "rpe_e1rm" and e1rm_kg is not None and pct is not None
            else None
        )
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
            )
        )
    return out
