"""Planned vs. lifted kg per set, kept across runs (the user's request, 2026-10-01): so later
analysis can show how often and how much kg is adjusted in the gym.

Rules (one call per set per compute run; the result is stored, never rebuilt or deleted):
- planned_first: the first kg seen while the session is not done; never overwritten.
- planned_last: the last kg seen while the session is not done; frozen once it is done.
- lifted: the kg while the session is done ("lifted" or "pre_log"); it follows later
  corrections (lifted_changed_at). If the session is un-matched later, lifted is cleared and
  the plan stays frozen.
- A kg first seen only after the session was done leaves planned null: "not observed", never
  "no adjustment" (blok 11, or kg entered and lifted between two runs).
- The key is what the set is (KgKey), not its sheet row: the coach inserting a row shifts
  sheet_row but keeps the key, so the history continues. A renamed or moved set gets a new key;
  the old row stays (history split, never lost or overwritten by another set).
"""

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import date, datetime

from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import KgStatus, SetKey, set_key

type KgKey = tuple[str, str, int, int, str, int, int]
"""(sheet_id, block, week, session, name, occurrence, set_no); occurrence = the row's rank among
rows with the same name in the same session, in sheet order (1 for the usual single row)."""


@dataclass(frozen=True, slots=True)
class KgState:
    key: KgKey
    sheet_row: int  # where the set is now (display/debug only; not part of the key)
    type: str
    reps_text: str | None
    prescribed: str | None
    week_start: date
    planned_first_kg: float | None
    planned_first_at: datetime | None
    planned_last_kg: float | None
    planned_last_at: datetime | None
    lifted_kg: float | None
    lifted_first_at: datetime | None
    lifted_changed_at: datetime | None
    first_seen_at: datetime


def kg_keys(sets: Iterable[StrengthSet]) -> dict[SetKey, KgKey]:
    """Each set's KgKey. Rows sharing (tab, week, session, name) are numbered in sheet order."""
    rows: dict[tuple[str, str, int, int, str], set[int]] = {}
    listed = list(sets)
    for s in listed:
        rows.setdefault((s.sheet_id, s.block, s.week, s.session, s.name), set()).add(s.sheet_row)
    rank = {
        (group, row): n
        for group, members in rows.items()
        for n, row in enumerate(sorted(members), start=1)
    }
    keys: dict[SetKey, KgKey] = {}
    for s in listed:
        group = (s.sheet_id, s.block, s.week, s.session, s.name)
        keys[set_key(s)] = (*group, rank[(group, s.sheet_row)], s.set_no)
    return keys


def next_kg_state(
    prev: KgState | None, s: StrengthSet, key: KgKey, status: KgStatus, now: datetime
) -> KgState:
    """The set's state after this run. Equal to ``prev`` when nothing changed."""
    if prev is None:
        state = KgState(
            key=key,
            sheet_row=s.sheet_row,
            type=s.type,
            reps_text=s.reps_text,
            prescribed=s.prescribed,
            week_start=s.week_start,
            planned_first_kg=None,
            planned_first_at=None,
            planned_last_kg=None,
            planned_last_at=None,
            lifted_kg=None,
            lifted_first_at=None,
            lifted_changed_at=None,
            first_seen_at=now,
        )
    else:
        state = replace(
            prev,
            sheet_row=s.sheet_row,
            type=s.type,
            reps_text=s.reps_text,
            prescribed=s.prescribed,
            week_start=s.week_start,
        )
    kg = s.logged_kg
    if status == "planned":
        if state.lifted_kg is not None:  # un-matched after being done: the plan stays frozen
            return replace(state, lifted_kg=None, lifted_changed_at=now)
        if state.lifted_first_at is not None or kg is None:
            return state  # done once already (frozen plan), or nothing planned yet
        if state.planned_first_kg is None:
            return replace(
                state,
                planned_first_kg=kg,
                planned_first_at=now,
                planned_last_kg=kg,
                planned_last_at=now,
            )
        if state.planned_last_kg != kg:
            return replace(state, planned_last_kg=kg, planned_last_at=now)
        return state
    # Done ("lifted" or "pre_log"): the plan is frozen, lifted follows the sheet.
    if state.lifted_first_at is None:
        return state if kg is None else replace(state, lifted_kg=kg, lifted_first_at=now)
    if state.lifted_kg != kg:
        return replace(state, lifted_kg=kg, lifted_changed_at=now)
    return state
