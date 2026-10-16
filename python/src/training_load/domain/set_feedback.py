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
from training_load.domain.strength_analysis import StrengthWeek, rolling_e1rm_at
from training_load.sources.strength_sheet import decimal_dots, set_score

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
    variant_id: int | None = None  # exercise_variants id; None = ukendt (2026-10-14)


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
        rpe, score = rescore(s, reps, s.muscle_factor)
        out.append(replace(s, reps=reps, rpe=rpe, score=round(score, 1)))
        applied += 1
    return out, applied


type SetOfWeek = tuple[date, int, int, int]  # (ISO week, session, sheet row, set number)


def skipped_sets(logged: Iterable[LoggedSet]) -> frozenset[SetOfWeek]:
    """Every working set (set_no >= 1) the user skipped in the app (exercise_set_log.skipped)."""
    return frozenset(_set_of(e) for e in logged if e.skipped and e.set_no >= 1)


def without_skipped(
    sets: Sequence[StrengthSet], logged: Iterable[LoggedSet]
) -> tuple[list[StrengthSet], int]:
    """``sets`` with every set the user skipped in the app (exercise_set_log.skipped, a working
    set, set_no >= 1) scored 0, so it adds no TSS (user, 2026-10-15, slice skip-tss); and how
    many. Reps, kg and RPE stay as the sheet has them; only the score is 0. Its kg status is
    "skipped" (strength_analysis.kg_statuses), so it is out of everything else too."""
    skipped = skipped_sets(logged)
    out: list[StrengthSet] = []
    applied = 0
    for s in sets:
        if (s.week_start, s.session, s.sheet_row, s.set_no) in skipped and s.score != 0:
            out.append(replace(s, score=0.0))
            applied += 1
        else:
            out.append(s)
    return out, applied


def rescore(
    s: StrengthSet, reps: float, factor: float, e1rm_kg: float | None = None
) -> tuple[float | None, float]:
    """(rpe, score) of ``s`` at ``reps`` with the sheet formula, unchanged. s.kg is already the
    effective kg (bodyweight included), so no bodyweight is added again. ``e1rm_kg``: the 1RM a
    %1RM RPE estimate divides by (default: the tab's, s.e1rm). A typed wrapper around the
    untyped legacy module, as domain.planned_load does."""
    # RPE as in the parser (strength_sheet.pick_rpe): logged, else prescribed (an unreadable
    # cell such as "RPE 7,8" is RPE unknown), else the %1RM estimate on a cell without an RPE.
    load = decimal_dots(s.prescribed)
    one_rm = s.e1rm if e1rm_kg is None else e1rm_kg
    e1rm = {s.type: one_rm} if one_rm is not None else {}
    # s.kg already holds kg_factor (and bodyweight); reps per side count both sides (s.sides).
    result: object = set_score(
        s.type, s.name, reps * s.sides, s.kg, load, None, factor, e1rm, s.logged_rpe
    )  # type: ignore[no-untyped-call]  # untyped legacy module
    assert isinstance(result, tuple)
    rpe = result[1]
    return (float(rpe) if isinstance(rpe, int | float) else None), float(result[2])


def _fmt(value: float) -> str:
    return f"{value:g}".replace(".", ",")


type VariantKey = tuple[int, int | None]
"""(exercise id, exercise_variants id or None = ukendt): progression, feel and suggestions group
per variant (user, 2026-10-14); switching variant starts over."""


def variants_of(sets: Sequence[StrengthSet]) -> dict[tuple[date, int, int, int], int | None]:
    """(ISO week, session, sheet row, set) -> the set's variant id: the log has no variant, so a
    logged set takes the variant of the sheet set it belongs to."""
    return {(s.week_start, s.session, s.sheet_row, s.set_no): s.variant_id for s in sets}


def progressions(
    logged: Sequence[LoggedSet], sets: Sequence[StrengthSet]
) -> dict[VariantKey, Progression]:
    """The progression rule that holds for each (exercise, variant) now."""
    tops = {(s.week_start, s.session, s.sheet_row, s.set_no): range_top(s.reps_text) for s in sets}
    variant = variants_of(sets)
    by_exercise: dict[VariantKey, list[LoggedSet]] = defaultdict(list)
    for e in logged:
        if _done(e):
            by_exercise[(e.exercise_id, variant.get(_set_of(e)))].append(e)
    out: dict[VariantKey, Progression] = {}
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


def exercise_feel(
    logged: Iterable[LoggedSet],
    offsets: Mapping[VariantKey, float | None],
    sets: Sequence[StrengthSet] = (),
) -> list[Feel]:
    """One line per (exercise, variant) with at least MIN_RATED rated sets. ``offsets``: per
    (exercise, variant), how far its next suggestion lies from the kg the coach's RPE gives
    (None: no RPE-based one). ``sets``: where each logged set's variant comes from."""
    variant = variants_of(sets)
    counts: dict[VariantKey, Counter[int]] = defaultdict(Counter)
    for e in logged:
        if _done(e) and e.felt is not None:
            counts[(e.exercise_id, variant.get(_set_of(e)))][e.felt] += 1
    out: list[Feel] = []
    for key, c in sorted(counts.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0)):
        exercise_id, variant_id = key
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
        offset = offsets.get(key)
        if offset is None:
            tail = ""
        elif offset > 0:
            tail = f" – forslaget ligger {_fmt(offset)} kg over {COACH_RPE}"  # noqa: RUF001  # Danish dash
        elif offset < 0:
            tail = f" – forslaget ligger {_fmt(-offset)} kg under {COACH_RPE}"  # noqa: RUF001  # Danish dash
        else:
            tail = f" – forslaget følger {COACH_RPE}"  # noqa: RUF001  # Danish dash
        out.append(
            Feel(exercise_id, rated, lighter, expected, harder, f"{head}{tail}.", variant_id)
        )
    return out


_MAIN_LIFTS: Final = ("SQUAT", "BENCH", "DEADLIFT")


def with_rolling_e1rm_rpe(
    sets: Sequence[StrengthSet], weeks: Sequence[StrengthWeek]
) -> tuple[list[StrengthSet], int]:
    """Main-lift sets whose cell prescribes no RPE (e.g. "-10%", "75%") and with no logged RPE
    get their %1RM RPE estimate from the app's rolling e1RM (user, 2026-10-13; the one e1RM
    rule, strength_analysis.rolling_e1rm_at, as the suggestions use it) instead of the
    tab's untested 1RM, which the parser used; the tab's stays only where no rolling e1RM
    exists. Scored again with the sheet formula, unchanged. Returns the sets and how many."""
    out: list[StrengthSet] = []
    changed = 0
    for s in sets:
        estimated = (
            s.type in _MAIN_LIFTS
            and "tempo" not in s.name.lower()
            and s.logged_rpe is None
            and (s.prescribed is None or "RPE" not in s.prescribed)
            and s.kg > 0
            and s.muscle_factor is not None
        )
        one_rm = rolling_e1rm_at(weeks, s.type, s.week_start) if estimated else None
        if one_rm is None or s.muscle_factor is None:
            out.append(s)
            continue
        rpe, score = rescore(s, s.reps, s.muscle_factor, one_rm)
        out.append(replace(s, rpe=rpe, score=round(score, 1)))
        changed += 1
    return out, changed
