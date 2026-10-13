"""What the Fokus pause screen collects, used by Python (user, 2026-10-13). Pure: no I/O.

- reps_done: on a range prescription ("8 - 12") the done tap stores the top and the stepper
  adjusts it. It replaces the range midpoint in the set's reps, and the set is scored again
  with the sheet formula (sources.strength_sheet.set_score, unchanged), so e1RM and strength
  TSS use the reps actually done.
- felt_rpe (-1 Lettere, 0 Som ventet, +1 Hårdere) and reps_done drive the progression rules
  (domain.planned_sets applies them inside the weekly cap; reasons start lowercase, as they
  follow a dash on screen):
    two Lettere in a row (the exercise's last two rated sets)        -> a step up
    two Hårdere in a row                                            -> hold (no rise)
    every set at the top of the range in the last two sessions       -> a step up
  A hold beats a step; one step at most.
- exercise_feel: per exercise with MIN_RATED rated sets, one Danish line for Analyse > Styrke.
Kg never comes from here: it stays in the coach's sheet.
"""

import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Final, Literal

from training_load.domain.strength import StrengthSet, iso_week_start
from training_load.sources.strength_sheet import decimal_dots, rpe_readable, set_score

MIN_RATED: Final = 4
COACH_RPE: Final = "trænerens RPE"
"""What the suggestion is measured against. The user's example named the coach; this repo is
public, so the text says "the coach's" (2026-10-13)."""

_RANGE = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$")


@dataclass(frozen=True, slots=True)
class LoggedSet:
    """A set row of exercise_set_log (warm-ups are left out on reading)."""

    day: date
    session: int
    row: int
    set_no: int
    exercise_id: int
    ended_at: str | None  # ISO timestamptz; None = not done
    skipped: bool
    felt: int | None  # -1 / 0 / +1; None = not rated
    reps_done: float | None  # None = not entered (a fixed-rep set, or not stored)


@dataclass(frozen=True, slots=True)
class Progression:
    kind: Literal["step", "hold"]
    reason: str  # Danish, shown after the suggestion


@dataclass(frozen=True, slots=True)
class Feel:
    exercise_id: int
    rated_n: int
    lighter_n: int
    expected_n: int
    harder_n: int
    verdict_text: str


def range_top(reps_text: str | None) -> float | None:
    """The top of a range prescription ("8 - 12" -> 12); None for fixed reps ("3")."""
    if reps_text is None:
        return None
    m = _RANGE.match(reps_text)
    if m is None:
        return None
    return max(float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", ".")))


def _done(entry: LoggedSet) -> bool:
    return entry.ended_at is not None and not entry.skipped


def _set_of(entry: LoggedSet) -> tuple[date, int, int, int]:
    return (iso_week_start(entry.day), entry.session, entry.row, entry.set_no)


def with_reps_done(
    sets: Sequence[StrengthSet], logged: Iterable[LoggedSet]
) -> tuple[list[StrengthSet], int]:
    """``sets`` with each range set's reps replaced by its logged reps_done and scored again;
    and how many were. A set without a muscle factor (stored by older code) keeps its score."""
    done = {_set_of(e): e.reps_done for e in logged if _done(e) and e.reps_done is not None}
    out: list[StrengthSet] = []
    applied = 0
    for s in sets:
        reps = done.get((s.week_start, s.session, s.sheet_row, s.set_no))
        if reps is None or range_top(s.reps_text) is None or s.muscle_factor is None:
            out.append(s)
            continue
        rpe, score = _rescore(s, reps, s.muscle_factor)
        out.append(replace(s, reps=reps, rpe=rpe, score=round(score, 1)))
        applied += 1
    return out, applied


def _rescore(s: StrengthSet, reps: float, factor: float) -> tuple[float | None, float]:
    """(rpe, score) of ``s`` at ``reps`` with the sheet formula, unchanged. s.kg is already the
    effective kg (bodyweight included), so no bodyweight is added again. A typed wrapper around
    the untyped legacy module, as domain.planned_load does."""
    # An unreadable RPE cell ("RPE 7,8") is never used, as in the parser: RPE unknown.
    readable = s.prescribed is not None and rpe_readable(s.prescribed)
    load = decimal_dots(s.prescribed) if readable else None
    e1rm = {s.type: s.e1rm} if s.e1rm is not None else {}
    result: object = set_score(s.type, s.name, reps, s.kg, load, None, factor, e1rm)  # type: ignore[no-untyped-call]  # untyped legacy module
    assert isinstance(result, tuple)
    rpe = result[1]
    return (float(rpe) if isinstance(rpe, int | float) else None), float(result[2])


def _fmt(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def progressions(
    logged: Sequence[LoggedSet], sets: Sequence[StrengthSet]
) -> dict[int, Progression]:
    """The progression rule that holds for each exercise now, by exercise id."""
    tops = {(s.week_start, s.session, s.sheet_row, s.set_no): range_top(s.reps_text) for s in sets}
    by_exercise: dict[int, list[LoggedSet]] = defaultdict(list)
    for e in logged:
        if _done(e):
            by_exercise[e.exercise_id].append(e)
    out: dict[int, Progression] = {}
    for exercise_id, entries in by_exercise.items():
        rated = sorted((e for e in entries if e.felt is not None), key=lambda e: e.ended_at or "")
        last_two = [e.felt for e in rated[-2:]]
        if last_two == [1, 1]:
            out[exercise_id] = Progression("hold", "de sidste to var hårdere")
            continue
        if last_two == [-1, -1]:
            out[exercise_id] = Progression("step", "de sidste to var lettere")
            continue
        sessions: dict[tuple[date, int], list[LoggedSet]] = defaultdict(list)
        for e in entries:
            sessions[(e.day, e.session)].append(e)
        recent = [sessions[k] for k in sorted(sessions)[-2:]]
        if len(recent) == 2 and all(_all_at_top(group, tops) for group in recent):
            top = tops[_set_of(recent[-1][0])]
            assert top is not None  # _all_at_top
            out[exercise_id] = Progression("step", f"du ramte {_fmt(top)} reps to gange")
    return out


def _all_at_top(
    group: Sequence[LoggedSet], tops: Mapping[tuple[date, int, int, int], float | None]
) -> bool:
    for e in group:
        top = tops.get(_set_of(e))
        if top is None or e.reps_done is None or e.reps_done < top:
            return False
    return bool(group)


def exercise_feel(logged: Iterable[LoggedSet], offsets: Mapping[int, float | None]) -> list[Feel]:
    """One line per exercise with at least MIN_RATED rated sets. ``offsets``: per exercise, how
    far its next suggestion lies from the kg the coach's RPE gives (None: no RPE-based one)."""
    counts: dict[int, Counter[int]] = defaultdict(Counter)
    for e in logged:
        if _done(e) and e.felt is not None:
            counts[e.exercise_id][e.felt] += 1
    out: list[Feel] = []
    for exercise_id, c in sorted(counts.items()):
        rated = sum(c.values())
        if rated < MIN_RATED:
            continue
        lighter, expected, harder = c[-1], c[0], c[1]
        if lighter > max(expected, harder):
            head = "Du melder oftest lettere end foreskrevet"
        elif harder > max(expected, lighter):
            head = "Du melder oftest hårdere end foreskrevet"
        else:
            head = "Du melder oftest som foreskrevet"
        offset = offsets.get(exercise_id)
        if offset is None:
            tail = ""
        elif offset > 0:
            tail = f" – forslaget ligger {_fmt(offset)} kg over {COACH_RPE}"  # noqa: RUF001  # Danish dash
        elif offset < 0:
            tail = f" – forslaget ligger {_fmt(-offset)} kg under {COACH_RPE}"  # noqa: RUF001  # Danish dash
        else:
            tail = f" – forslaget følger {COACH_RPE}"  # noqa: RUF001  # Danish dash
        out.append(Feel(exercise_id, rated, lighter, expected, harder, f"{head}{tail}."))
    return out
