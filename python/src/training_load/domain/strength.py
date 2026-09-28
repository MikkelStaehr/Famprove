"""Strength rules on top of the parsed sets: filled weeks, counted sets, STRENGTH_K, blocks.

The per-set ``score`` itself is NOT computed here; it comes from the original
strength_collector formula in ``sources.strength_sheet`` and is stored as-is.

Definitions (a "week" is a 1-based week index inside one tab of one sheet):
  filled week     at least one set in that week with type != ABS_TYPE, not bodyweight,
                  and logged_kg > 0.
  counted set     a set in a filled week whose date <= today. Only these count toward TSS.
  week start      the earliest set date in that week (a week spans several session dates).
  block           one per (sheet_id, tab) that has at least one set (filled weeks here must
                  also have started: week start <= today):
    start_date    earliest set date in the tab (first week with any prescribed set)
    end_date      week start of the last filled week + 6 days; None if no week is filled
    finished      a block of the same sheet with a higher block_no has a filled week, OR the
                  tab's last prescribed week (highest week index) is itself filled
    deload_start  week start of the last filled week, only when finished; else None
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
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
    date: date
    type: str
    name: str
    reps: float
    logged_kg: float
    kg: float
    bodyweight: bool
    rpe: float | None
    score: float  # raw, before STRENGTH_K


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


def _week_key(s: StrengthSet) -> WeekKey:
    return (s.sheet_id, s.block, s.week)


def filled_weeks(sets: Iterable[StrengthSet]) -> frozenset[WeekKey]:
    """Keys of every filled week (see module docstring)."""
    return frozenset(
        _week_key(s) for s in sets if s.type != ABS_TYPE and not s.bodyweight and s.logged_kg > 0
    )


def week_starts(sets: Iterable[StrengthSet]) -> dict[WeekKey, date]:
    """Earliest set date per week key."""
    starts: dict[WeekKey, date] = {}
    for s in sets:
        key = _week_key(s)
        if key not in starts or s.date < starts[key]:
            starts[key] = s.date
    return starts


def counted_sets(sets: Sequence[StrengthSet], today: date) -> list[StrengthSet]:
    """Sets in filled weeks with date <= today."""
    filled = filled_weeks(sets)
    return [s for s in sets if _week_key(s) in filled and s.date <= today]


def daily_strength_tss(sets: Sequence[StrengthSet], today: date, k: float) -> dict[date, float]:
    """Per date: sum(score) over counted_sets(sets, today), times ``k`` (STRENGTH_K).

    Not rounded; rounding is a display concern.
    """
    raw: dict[date, float] = {}
    for s in counted_sets(sets, today):
        raw[s.date] = raw.get(s.date, 0.0) + s.score
    return {day: score * k for day, score in raw.items()}


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
                start_date=min(s.date for s in tab_sets),
                end_date=last_filled_start + timedelta(days=6) if last_filled_start else None,
                deload_start=last_filled_start if finished else None,
            )
        )
    return sorted(blocks, key=lambda b: (b.sheet_id, b.block_no))
