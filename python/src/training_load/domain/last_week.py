"""Last week's kg: the one place Python answers "what did the user have on this row before"
(user, 2026-10-16, slice last-week-kg; moved here from planned_sets, today_kg and planned_load
without a change, which the golden test holds). Pure: no I/O, and no import of the modules that
use it (what counts as lifted, skipped or an RPE row comes in as a predicate).

Three questions, three rules, each as it was:

- anchor_kg (planned_sets: the weekly cap, the progression base, the warm-up ramp base): last
  week's first set (lowest set_no) with kg > 0 of the row, an RPE row, counted (lifted or
  pre_log); the same exercise by name (casefold), prescribed reps (text) and variant.
- same_set_last_week (today_kg's "samme som sidst"): the same set number last week, with
  kg > 0 or bodyweight, anything but skipped in the app; the same exercise by name (lower) and
  variant, and the same reps (number).
- latest_logged_kg (planned_load, the prognose: a planned accessory's kg): the row's latest
  earlier week with kg > 0, else the name's (lower, any variant) latest earlier ISO week; any
  status (compute leaves the skipped sets out of its history).

The web's "Sidste uge" (training-view.references) is a fourth reading, unchanged (user: the web
stays as it is).
"""

from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import date, timedelta

from training_load.domain.strength import StrengthSet

type RowWeek = tuple[str, int, date]  # block, sheet_row, week_start
type SetRef = tuple[str, str, int, int, date]  # sheet_id, block, sheet_row, set_no, week_start


# --- the anchor (planned_sets) --------------------------------------------------------------------


def first_counted_by_row(
    sets: Iterable[StrengthSet],
    *,
    counted: Callable[[StrengthSet], bool],
    rpe_row: Callable[[StrengthSet], bool],
) -> dict[RowWeek, StrengthSet]:
    """(block, sheet_row, week_start) -> the first set with logged kg of each counted RPE row, as
    Træning's "Sidste uge" shows it. A session that wasn't lifted (pre-filled kg of a missed
    session) anchors nothing."""
    first: dict[RowWeek, StrengthSet] = {}
    for s in sets:
        if not counted(s) or s.logged_kg is None or s.logged_kg <= 0:
            continue
        key = (s.block, s.sheet_row, s.week_start)
        if key not in first or s.set_no < first[key].set_no:
            first[key] = s
    return {key: s for key, s in first.items() if rpe_row(s)}


def same_name_casefold(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


def same_prescribed_reps(a: StrengthSet, b: StrengthSet) -> bool:
    """The same prescribed reps: the sheet's text ("8 - 12"), since a done range set's reps are
    the reps done (domain.set_feedback)."""
    if a.reps_text is not None and b.reps_text is not None:
        return a.reps_text.strip() == b.reps_text.strip()
    return a.reps == b.reps


def anchor_kg(s: StrengthSet, firsts: Mapping[RowWeek, StrengthSet]) -> float | None:
    """Last week's anchor for ``s`` (``firsts`` from first_counted_by_row): its kg when it is the
    same exercise, prescribed reps and variant (None matches only None), else None."""
    before = firsts.get((s.block, s.sheet_row, s.week_start - timedelta(days=7)))
    if (
        before is not None
        and same_name_casefold(before.name, s.name)
        and same_prescribed_reps(before, s)
        and before.variant_id == s.variant_id
    ):
        return before.logged_kg
    return None


# --- the same set (today_kg) ----------------------------------------------------------------------


def same_exercise(a: StrengthSet, b: StrengthSet) -> bool:
    """The same exercise and variant (null only matches null), as today_kg compares sets."""
    return a.name.strip().lower() == b.name.strip().lower() and a.variant_id == b.variant_id


def same_set_last_week(
    s: StrengthSet,
    by_ref: Mapping[SetRef, StrengthSet],
    *,
    skipped: Callable[[StrengthSet], bool],
) -> StrengthSet | None:
    """Last week's set with the same row and set number, when it has a kg (0 only on a
    bodyweight exercise), wasn't skipped in the app, and is the same exercise, variant and reps."""
    before = by_ref.get(
        (s.sheet_id, s.block, s.sheet_row, s.set_no, s.week_start - timedelta(days=7))
    )
    if (
        before is not None
        and not skipped(before)  # planned / pre_log: as the sheet
        and same_exercise(before, s)
        and before.reps == s.reps
        and before.logged_kg is not None
        and (before.logged_kg > 0 or before.bodyweight)
    ):
        return before
    return None


# --- the latest kg (planned_load, the prognose) --------------------------------------------------


def _logged(s: StrengthSet) -> float:
    """The logged kg of a set already filtered to logged_kg > 0."""
    if s.logged_kg is None:
        raise ValueError("expected a set with logged kg")
    return s.logged_kg


def latest_logged_kg(s: StrengthSet, history: Sequence[StrengthSet]) -> tuple[float, str] | None:
    """A planned accessory's kg: the latest earlier week of the same row ("same_row"), else the
    latest earlier ISO week of the same name ("same_name"); None without either."""
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
