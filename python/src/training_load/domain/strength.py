"""Strength rules on top of the parsed sets: session numbers, filled weeks, blocks.

The per-set ``score`` itself is NOT computed here; it comes from the original
strength_collector formula in ``sources.strength_sheet`` and is stored as-is. Which sets
count toward strength TSS is decided in ``domain.sessions`` (a session counts once a
strength activity is matched to it).

Sessions: the coach's sheet defines sessions 1..N per ISO week (Mon-Sun), never weekdays.
  week start      Monday of the ISO week of the tab's week (earliest sheet date of that
                  week in the tab; only its ISO week is used, never its weekday).
  session         the day sections (date rows) of the tab that prescribe at least one set
                  that week, numbered 1..N in sheet order. If two tabs prescribe sets in the
                  same ISO week, they are numbered in block-number order.

Blocks (a "week" is a 1-based week index inside one tab of one sheet):
  filled week     at least one set in that week with type != ABS_TYPE, not bodyweight,
                  and logged_kg > 0 (None = not logged).
  block           one per (sheet_id, tab) that has at least one set (filled weeks here must
                  also have started: week start <= today):
    start_date    earliest week start in the tab (first week with any prescribed set)
    end_date      week start of the last filled week + 6 days; None if no week is filled
    finished      a block of the same sheet with a higher block_no has a filled week, OR the
                  tab's last prescribed week (highest week index) is itself filled
    deload_start  week start of the last filled week, only when finished; else None
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Final

ABS_TYPE: Final = "ABS"
"""The type label the parser assigns to ab work (it gets a fixed score, never fills a week)."""

_BLOCK_NO: Final = re.compile(r"program\s*-\s*blok\s*(\d+)", re.IGNORECASE)

type WeekKey = tuple[str, str, int]
"""(sheet_id, block tab name, week index)."""


@dataclass(frozen=True, slots=True)
class StrengthSet:
    """One prescribed set; mirrors a public.strength_sets row."""

    sheet_id: str
    block: str
    sheet_row: int
    week: int
    set_no: int
    week_start: date  # Monday of the ISO week
    session: int  # 1..N within the ISO week
    type: str
    name: str
    reps: float
    # None: not entered or unreadable (never a silent 0). 0 is real only when bodyweight is True
    # (bodyweight only, no added load); the parser stores a weighted exercise's 0 as None.
    logged_kg: float | None
    kg: float
    bodyweight: bool
    rpe: float | None
    score: float  # raw, before STRENGTH_K
    prescribed: str | None = None  # coach's load cell as text; display only
    sets_text: str | None = None  # coach's sets cell as written; display only
    reps_text: str | None = None  # coach's reps cell as written (e.g. "8 - 12"); display only
    e1rm: float | None = None  # the tab's 1RM for this lift (main lifts only), for planned kg
    logged_rpe: float | None = None  # LSRPE as logged (whole or half 1-10); None = not logged
    raw: Mapping[str, object] | None = field(default=None, compare=False)
    """The week's cells as written (sets .. mean_weight); None for rows stored before raw."""


@dataclass(frozen=True, slots=True)
class Block:
    """Mirrors a public.blocks row. Deload flag == (deload_start is not None)."""

    sheet_id: str
    name: str
    block_no: int
    start_date: date
    end_date: date | None
    deload_start: date | None


def block_number(tab: str) -> int:
    """N from "Program - blok N ..." (case-insensitive). ValueError if there is no number."""
    match = _BLOCK_NO.match(tab.strip())
    if match is None:
        raise ValueError(f"not a numbered block tab: {tab!r}")
    return int(match.group(1))


def has_block_number(tab: str) -> bool:
    """True iff block_number(tab) would succeed."""
    return _BLOCK_NO.match(tab.strip()) is not None


def iso_week_start(day: date) -> date:
    """Monday of ``day``'s ISO week."""
    return day - timedelta(days=day.weekday())


type SectionKey = tuple[str, int, int]
"""(block tab name, week index, section index) of one sheet section in one week."""


@dataclass(frozen=True, slots=True)
class SessionSlot:
    week_start: date
    session: int


def number_sessions(sections: Iterable[tuple[SectionKey, date]]) -> dict[SectionKey, SessionSlot]:
    """Number the sections that prescribe sets, per ISO week (see module docstring).

    ``sections`` holds one (section key, sheet date) pair per prescribed set (duplicates
    are fine). Every tab must have a block number (``has_block_number``).
    """
    week_dates: dict[tuple[str, int], date] = {}
    keys: set[SectionKey] = set()
    for key, day in sections:
        keys.add(key)
        week = key[:2]
        if week not in week_dates or day < week_dates[week]:
            week_dates[week] = day
    by_week: dict[date, list[SectionKey]] = {}
    for key in keys:
        by_week.setdefault(iso_week_start(week_dates[key[:2]]), []).append(key)
    slots: dict[SectionKey, SessionSlot] = {}
    for week_start, week_keys in by_week.items():
        ordered = sorted(week_keys, key=lambda k: (block_number(k[0]), k[0], k[2]))
        for n, key in enumerate(ordered, start=1):
            slots[key] = SessionSlot(week_start=week_start, session=n)
    return slots


def shared_weeks(slots: dict[SectionKey, SessionSlot]) -> list[date]:
    """ISO weeks whose sessions come from more than one tab (logged as a warning)."""
    tabs: dict[date, set[str]] = {}
    for key, slot in slots.items():
        tabs.setdefault(slot.week_start, set()).add(key[0])
    return sorted(week for week, names in tabs.items() if len(names) > 1)


def _week_key(s: StrengthSet) -> WeekKey:
    return (s.sheet_id, s.block, s.week)


def filled_weeks(sets: Iterable[StrengthSet]) -> frozenset[WeekKey]:
    """Keys of every filled week (see module docstring)."""
    return frozenset(
        _week_key(s)
        for s in sets
        if s.type != ABS_TYPE and not s.bodyweight and s.logged_kg is not None and s.logged_kg > 0
    )


def week_starts(sets: Iterable[StrengthSet]) -> dict[WeekKey, date]:
    """ISO week start per week key (the earliest, should a tab week span two ISO weeks)."""
    starts: dict[WeekKey, date] = {}
    for s in sets:
        key = _week_key(s)
        if key not in starts or s.week_start < starts[key]:
            starts[key] = s.week_start
    return starts


def derive_blocks(sets: Sequence[StrengthSet], today: date) -> list[Block]:
    """One Block per (sheet_id, tab) present in ``sets``, per the module docstring rules.

    Only weeks that have started (week start <= today) count as filled here: kg entered
    ahead of time must not end a block or flag its deload early. "Later block" is decided by
    block_number within the same sheet_id. Sorted by (sheet_id, block_no).
    """
    starts = week_starts(sets)
    filled = {k for k in filled_weeks(sets) if starts[k] <= today}

    tabs: dict[tuple[str, str], list[StrengthSet]] = {}
    for s in sets:
        tabs.setdefault((s.sheet_id, s.block), []).append(s)

    numbers = {key: block_number(key[1]) for key in tabs}
    has_filled_week = {key: any(k[:2] == key for k in filled) for key in tabs}

    blocks: list[Block] = []
    for (sheet_id, name), tab_sets in tabs.items():
        block_no = numbers[(sheet_id, name)]
        filled_indices = sorted(k[2] for k in filled if k[:2] == (sheet_id, name))
        last_filled = filled_indices[-1] if filled_indices else None
        last_prescribed = max(s.week for s in tab_sets)

        later_block_started = any(
            other_sheet == sheet_id and numbers[(other_sheet, other)] > block_no and started
            for (other_sheet, other), started in has_filled_week.items()
        )
        finished = last_filled is not None and (
            last_filled == last_prescribed or later_block_started
        )

        last_filled_start = (
            starts[(sheet_id, name, last_filled)] if last_filled is not None else None
        )
        blocks.append(
            Block(
                sheet_id=sheet_id,
                name=name,
                block_no=block_no,
                start_date=min(s.week_start for s in tab_sets),
                end_date=last_filled_start + timedelta(days=6) if last_filled_start else None,
                deload_start=last_filled_start if finished else None,
            )
        )
    return sorted(blocks, key=lambda b: (b.sheet_id, b.block_no))
