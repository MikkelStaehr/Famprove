"""Today's kg per planned set, the figure Fokus shows under "I DAG" (user, 2026-10-15, slice
fokus-kg). Pure: no I/O. The first rule that applies, per set:

1. ``sheet``: the sheet's kg for the set this week (strength_sets.logged_kg: the plan the sheet
   holds before the session; 0 only on a bodyweight exercise = bodyweight alone).
2. ``derived``, from another set of the same exercise (and variant) in the same session that has
   a kg (sheet or derived):
   - an RPE row: from the sibling with the highest prescribed RPE (a tie: the nearest row), by the
     e1RM relation kg_a x (1 + F (r_a + 10 - rpe_a)) / (1 + F (r + 10 - rpe)), F = 0.0333;
   - a "-x %" row: (1 - x) x the heaviest kg of the exercise that session (planned_load's backoff
     rule; the sheet's own -12.5 % row: 0.875 x 145 = 126.875 -> 127.5);
   rounded to the nearest 2.5 (halves up, like the sheet's MROUND).
3. ``e1rm``: Python's suggestion (planned_sets.suggested_kg from the rolling e1RM), shown "~".
4. ``last``: last week's kg for the same row and set ("samme som sidst").
Otherwise None: Fokus shows no kg block. Never 0 where the sheet has no 0.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.planned_load import prescribed_rpe
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import E1RM_FACTOR

type TodayBasis = Literal["sheet", "derived", "e1rm", "last"]
TODAY_BASES: Final = ("sheet", "derived", "e1rm", "last")
STEP_KG: Final = 2.5


@dataclass(frozen=True, slots=True)
class TodayKg:
    kg: float
    basis: TodayBasis


type SetRef = tuple[str, str, int, int, date]  # sheet_id, block, sheet_row, set_no, week_start


def ref(s: StrengthSet) -> SetRef:
    return (s.sheet_id, s.block, s.sheet_row, s.set_no, s.week_start)


def round_step(kg: float) -> float:
    """Nearest multiple of 2.5, halves up (126.875 -> 127.5), like the sheet's MROUND."""
    return int(kg / STEP_KG + 0.5) * STEP_KG


def percent(prescribed: str | None) -> float | None:
    """ "-12.5%" -> -0.125, "-10%" -> -0.10; anything else None (an RPE row, a %1RM row "75%")."""
    text = (prescribed or "").strip().replace(",", ".").replace(" ", "")
    if not text.endswith("%") or not text.startswith("-"):
        return None
    try:
        return float(text[:-1]) / 100
    except ValueError:
        return None


def _e1rm_ratio(reps: float, rpe: float) -> float:
    return 1 + E1RM_FACTOR * (reps + 10 - rpe)


def _same_exercise(a: StrengthSet, b: StrengthSet) -> bool:
    return a.name.strip().lower() == b.name.strip().lower() and a.variant_id == b.variant_id


def today_kgs(
    sets: Sequence[StrengthSet],
    suggested: Mapping[SetRef, float | None],
    *,
    run_week: date,
) -> dict[SetRef, TodayKg]:
    """Today's kg for every set of ``run_week`` and later. ``suggested``: Python's suggestion per
    set (planned_sets.suggested_kg). Last week's kg comes from ``sets`` itself (same block, row
    and set number, the week before, with a kg)."""
    by_ref = {ref(s): s for s in sets}
    out: dict[SetRef, TodayKg] = {}
    sessions: dict[tuple[str, str, date, int], list[StrengthSet]] = {}
    for s in sets:
        if s.week_start >= run_week:
            sessions.setdefault((s.sheet_id, s.block, s.week_start, s.session), []).append(s)
    for session_sets in sessions.values():
        # 1. the sheet's own kg
        for s in session_sets:
            if s.logged_kg is not None and (s.logged_kg > 0 or s.bodyweight):
                out[ref(s)] = TodayKg(s.logged_kg, "sheet")
        # 2a. RPE rows from a sibling with a kg and an RPE
        for s in session_sets:
            rpe = prescribed_rpe(s.prescribed)
            if ref(s) in out or rpe is None:
                continue
            anchors = [
                (prescribed_rpe(a.prescribed), -abs(a.sheet_row - s.sheet_row), a)
                for a in session_sets
                if a is not s
                and _same_exercise(a, s)
                and ref(a) in out
                and out[ref(a)].kg > 0
                and prescribed_rpe(a.prescribed) is not None
            ]
            if not anchors:
                continue
            a_rpe, _, a = max(anchors, key=lambda t: (t[0] or 0.0, t[1]))
            assert a_rpe is not None
            kg = out[ref(a)].kg * _e1rm_ratio(a.reps, a_rpe) / _e1rm_ratio(s.reps, rpe)
            out[ref(s)] = TodayKg(round_step(kg), "derived")
        # 2b. "-x %" rows from the heaviest sheet or derived kg of the exercise that session
        _backoffs(session_sets, out, kinds=("sheet", "derived"), basis="derived")
        # 3. the e1RM suggestion (not on a "-x %" row: those follow their top set below)
        for s in session_sets:
            sug = suggested.get(ref(s))
            if ref(s) not in out and percent(s.prescribed) is None and sug is not None and sug > 0:
                out[ref(s)] = TodayKg(sug, "e1rm")
        # 3b. "-x %" rows whose top set is only an estimate: an estimate too (the weakest input)
        _backoffs(session_sets, out, kinds=("sheet", "derived", "e1rm"), basis="e1rm")
        # 4. last week's kg for the same row and set
        for s in session_sets:
            if ref(s) in out:
                continue
            before = by_ref.get(
                (s.sheet_id, s.block, s.sheet_row, s.set_no, s.week_start - timedelta(days=7))
            )
            if (
                before is not None
                and before.logged_kg is not None
                and (before.logged_kg > 0 or before.bodyweight)
            ):
                out[ref(s)] = TodayKg(before.logged_kg, "last")
    return out


def _backoffs(
    session_sets: Sequence[StrengthSet],
    out: dict[SetRef, TodayKg],
    *,
    kinds: tuple[TodayBasis, ...],
    basis: TodayBasis,
) -> None:
    """Each open "-x %" row: (1 - x) x the heaviest kg of the same exercise that session among the
    sets whose today kg has one of ``kinds``, rounded to 2.5, with ``basis``."""
    for s in session_sets:
        pct = percent(s.prescribed)
        if ref(s) in out or pct is None:
            continue
        tops = [
            out[ref(a)].kg
            for a in session_sets
            if a is not s
            and _same_exercise(a, s)
            and percent(a.prescribed) is None
            and ref(a) in out
            and out[ref(a)].basis in kinds
        ]
        if tops and max(tops) > 0:
            out[ref(s)] = TodayKg(round_step(max(tops) * (1 + pct)), basis)
