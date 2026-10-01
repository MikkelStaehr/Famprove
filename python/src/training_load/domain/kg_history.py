"""Planned vs. lifted kg per set, kept across runs (the user's request, 2026-10-01): so later
analysis can show how often and how much kg is adjusted in the gym.

Rules (one call per set per compute run; the result is stored, never rebuilt):
- planned_first: the first kg seen while the session is not done; never overwritten.
- planned_last: the last kg seen while the session is not done; frozen once it is done.
- lifted: the kg while the session is done ("lifted" or "pre_log"); it follows later
  corrections (lifted_changed_at). If the session is un-matched later, lifted is cleared and
  the plan stays frozen.
- A kg first seen only after the session was done leaves planned null: "not observed", never
  "no adjustment" (blok 11, or kg entered and lifted between two runs).
- The key is strength_sets' primary key, which shifts if the coach inserts a row: a changed
  fingerprint (type, name, reps_text, prescribed) starts the row over (resets + 1).
"""

from dataclasses import dataclass, replace
from datetime import date, datetime

from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import KgStatus, SetKey, set_key

type Fingerprint = tuple[str, str, str | None, str | None]


@dataclass(frozen=True, slots=True)
class KgState:
    key: SetKey
    type: str
    name: str
    reps_text: str | None
    prescribed: str | None
    week_start: date
    session: int
    planned_first_kg: float | None
    planned_first_at: datetime | None
    planned_last_kg: float | None
    planned_last_at: datetime | None
    lifted_kg: float | None
    lifted_first_at: datetime | None
    lifted_changed_at: datetime | None
    resets: int
    first_seen_at: datetime

    @property
    def fingerprint(self) -> Fingerprint:
        return (self.type, self.name, self.reps_text, self.prescribed)


def fingerprint(s: StrengthSet) -> Fingerprint:
    return (s.type, s.name, s.reps_text, s.prescribed)


def _fresh(s: StrengthSet, now: datetime, resets: int) -> KgState:
    return KgState(
        key=set_key(s),
        type=s.type,
        name=s.name,
        reps_text=s.reps_text,
        prescribed=s.prescribed,
        week_start=s.week_start,
        session=s.session,
        planned_first_kg=None,
        planned_first_at=None,
        planned_last_kg=None,
        planned_last_at=None,
        lifted_kg=None,
        lifted_first_at=None,
        lifted_changed_at=None,
        resets=resets,
        first_seen_at=now,
    )


def next_kg_state(prev: KgState | None, s: StrengthSet, status: KgStatus, now: datetime) -> KgState:
    """The set's state after this run. Equal to ``prev`` when nothing changed."""
    if prev is None:
        state = _fresh(s, now, resets=0)
    elif prev.fingerprint != fingerprint(s):
        state = _fresh(s, now, resets=prev.resets + 1)
    else:
        state = replace(prev, week_start=s.week_start, session=s.session)
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
