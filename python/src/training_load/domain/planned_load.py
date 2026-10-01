"""Planned strength load: score a session the user hasn't done yet from the coach's plan.

Future weeks have no kg in the sheet, so the score formula (sources.strength_sheet.set_score,
reused unchanged) needs a planned kg per set. Rules, in order (decided with the user, 2026-10-01):
  entered       kg the user already wrote in the sheet: the stored score is used as-is
  abs/bodyweight the stored score already holds the fixed ABS score or BODYWEIGHT (+ any kg)
  rpe_e1rm      main lift (SQUAT/BENCH/DEADLIFT, not tempo) with "RPE x": kg = e1RM x the
                formula's own %1RM for that RPE and reps, 1 / (1 + 0.0333 * (reps + 10 - RPE))
  pct_e1rm      main lift with a "75%" load cell: kg = e1RM x 75%
  backoff       a "-10%" row: 90% of the heaviest planned set of the same exercise that session
  same_row      accessory: the latest kg logged on the same sheet row earlier in this block
  same_name     accessory: the latest kg logged for the same exercise name in any earlier week
  (none)        no kg found: the set is NOT scored and is counted as unscored, never 0
An RPE cell that isn't whole or half values on 1-10 ("RPE 7,8") is never used: that set is
unscored too (strength_sheet.rpe_readable, the user's rule of 2026-10-01).
"""

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from training_load.domain.strength import StrengthSet
from training_load.sources.strength_sheet import (
    BODYWEIGHT_EX,
    decimal_dots,
    mid,
    rpe_readable,
    set_score,
)

MAIN_LIFTS: Final = frozenset({"SQUAT", "BENCH", "DEADLIFT"})
_PERCENT: Final = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)\s*%\s*$")


@dataclass(frozen=True, slots=True)
class PlannedScore:
    score: float  # raw, before STRENGTH_K; sum over the scored sets
    sets: int
    unscored: int  # sets without any kg rule: left out, listed
    sources: dict[str, int]  # kg source -> sets


def _percent(prescribed: str | None) -> float | None:
    """ "75%" -> 0.75, "-10%" -> -0.10, anything else -> None."""
    match = _PERCENT.match(prescribed or "")
    return float(match.group(1).replace(",", ".")) / 100 if match else None


# The legacy formula module is untyped on purpose (its lines never change); it is called through
# these two typed wrappers only.
def _legacy_mid(text: str) -> float | None:
    value: object = mid(text)  # type: ignore[no-untyped-call]  # untyped legacy module, see above
    return float(value) if isinstance(value, int | float) else None


def _legacy_score(s: StrengthSet, kg: float, e1rm: dict[str, float]) -> float:
    load = decimal_dots(s.prescribed)  # "RPE 7,5" is 7.5, as in the parser
    result: object = set_score(s.type, s.name, s.reps, kg, load, 0.0, e1rm)  # type: ignore[no-untyped-call]  # untyped legacy module, see above
    assert isinstance(result, tuple)
    return float(result[2])


def _rpe(prescribed: str | None) -> float | None:
    if prescribed is None or "RPE" not in prescribed or not rpe_readable(prescribed):
        return None
    return _legacy_mid(str(decimal_dots(prescribed)))


def _is_bodyweight(s: StrengthSet) -> bool:
    return s.bodyweight or any(b in s.name.lower() for b in BODYWEIGHT_EX)


def _main_lift_kg(s: StrengthSet) -> tuple[float, str] | None:
    if s.type not in MAIN_LIFTS or "tempo" in s.name.lower() or s.e1rm is None:
        return None
    rpe = _rpe(s.prescribed)
    if rpe is not None:
        return s.e1rm / (1 + 0.0333 * (s.reps + 10 - rpe)), "rpe_e1rm"
    pct = _percent(s.prescribed)
    if pct is not None and pct > 0:
        return s.e1rm * pct, "pct_e1rm"
    return None


def _logged(s: StrengthSet) -> float:
    """The logged kg of a set already filtered to logged_kg > 0."""
    if s.logged_kg is None:
        raise ValueError("expected a set with logged kg")
    return s.logged_kg


def _accessory_kg(s: StrengthSet, history: Sequence[StrengthSet]) -> tuple[float, str] | None:
    logged = [h for h in history if h.logged_kg is not None and h.logged_kg > 0]
    same_row = [
        h for h in logged if h.block == s.block and h.sheet_row == s.sheet_row and h.week < s.week
    ]
    if same_row:
        return _logged(max(same_row, key=lambda h: h.week)), "same_row"
    name = s.name.strip().lower()
    same_name = [
        h for h in logged if h.name.strip().lower() == name and h.week_start < s.week_start
    ]
    if same_name:
        return _logged(max(same_name, key=lambda h: h.week_start)), "same_name"
    return None


def _raw_score(s: StrengthSet, kg: float) -> float:
    # bodyweight 0: bodyweight sets never get here (their stored score already includes it).
    return _legacy_score(s, kg, {s.type: s.e1rm} if s.e1rm is not None else {})


def planned_session_score(
    session_sets: Sequence[StrengthSet], history: Sequence[StrengthSet]
) -> PlannedScore:
    """Raw score of one planned session (all its sets), per the module rules.

    ``history`` is every stored set (for the accessory look-ups).
    """
    sources: Counter[str] = Counter()
    total = 0.0
    unscored = 0
    planned_kg: dict[int, float] = {}  # id(set) -> kg, for the backoff rows
    backoffs: list[StrengthSet] = []
    for s in session_sets:
        if s.logged_kg is not None or s.type == "ABS" or _is_bodyweight(s):
            source = (
                "entered"
                if s.logged_kg is not None
                else ("abs" if s.type == "ABS" else "bodyweight")
            )
            total += s.score
            sources[source] += 1
            if s.logged_kg is not None:
                planned_kg[id(s)] = s.logged_kg
            continue
        if not rpe_readable(s.prescribed):  # e.g. "RPE 7,8": never used
            unscored += 1
            continue
        pct = _percent(s.prescribed)
        if pct is not None and pct < 0:
            backoffs.append(s)
            continue
        found = _main_lift_kg(s) or _accessory_kg(s, history)
        if found is None:
            unscored += 1
            continue
        kg, source = found
        planned_kg[id(s)] = kg
        total += _raw_score(s, kg)
        sources[source] += 1
    for s in backoffs:
        tops = [
            planned_kg[id(t)]
            for t in session_sets
            if id(t) in planned_kg and t.name.strip().lower() == s.name.strip().lower()
        ]
        pct = _percent(s.prescribed)  # always "-x%" here: that's how backoffs were picked
        if pct is None or not tops:
            unscored += 1
            continue
        total += _raw_score(s, max(tops) * (1 + pct))
        sources["backoff"] += 1
    return PlannedScore(
        score=total, sets=len(session_sets), unscored=unscored, sources=dict(sources)
    )
