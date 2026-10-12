"""The exercise catalogue (public.exercises): two inputs of the strength score per exercise.

Decided with the user (2026-10-12): the formula's muscle factor (it was 1.0 for leg TYPEs and 0.6
for the rest) and the bodyweight added to bodyweight exercises (it was the full BODYWEIGHT for
names containing dips/chin/pull-up/push-up) come from this table, which the user edits by hand.
Everything else in the formula (sources.strength_sheet.set_score) is unchanged.

  effective kg = logged kg + BODYWEIGHT x bodyweight_fraction   (fraction null: not a bodyweight
                                                                  exercise, nothing is added)

A sheet name matches an exercise's name or one of its aliases, trimmed and case-insensitive (the
same rule as the table's unique index on lower(btrim(name))). An unknown name is scored as an
accessory (UNKNOWN_FACTOR, no bodyweight) and is reported, never silent: collect-strength logs it
and adds it to the table for the user to correct.
"""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Final

CATEGORIES: Final = ("main", "accessory", "isolation", "bodyweight", "abs")
UNKNOWN_CATEGORY: Final = "accessory"
UNKNOWN_FACTOR: Final = 0.6


@dataclass(frozen=True, slots=True)
class Exercise:
    """Mirrors a public.exercises row."""

    id: int
    name: str
    aliases: tuple[str, ...]
    category: str
    parent_lift: str | None  # SQUAT / BENCH / DEADLIFT for a main lift or its variant
    muscle_factor: float
    bodyweight_fraction: float | None  # None: not a bodyweight exercise (0 would add nothing)
    tracks_e1rm: bool  # stored for later; nothing reads it yet
    suggestion_scale: float = 1.0  # multiplies the suggested kg (tempo variants 0.8)


@dataclass(frozen=True, slots=True)
class Scoring:
    """What the strength formula needs to know about one sheet row's exercise."""

    muscle_factor: float
    bodyweight_kg: float | None  # BODYWEIGHT x fraction; None: not a bodyweight exercise


type Scorer = Callable[[str, str], Scoring]
"""(sheet TYPE, exercise name) -> Scoring. The catalogue scores by name only; the TYPE is there
for callers that score by the sheet's TYPE (the tests' copy of the old rule)."""


def name_key(name: str) -> str:
    """The matching key: trimmed, lower case (as SQL's lower(btrim(name)))."""
    return name.strip().lower()


class Catalog:
    """Name and alias look-up over the catalogue rows.

    A canonical name always wins over an alias. When an alias names a different exercise than
    an earlier one (or another exercise's name), the first by id keeps it and the clash is listed
    in ``conflicts`` for a warning: the user has to fix the table, the run doesn't guess silently.
    """

    def __init__(self, exercises: Iterable[Exercise]) -> None:
        ordered = sorted(exercises, key=lambda e: e.id)
        self._by_key: dict[str, Exercise] = {}
        self.conflicts: list[str] = []
        for e in ordered:
            self._by_key.setdefault(name_key(e.name), e)
        for e in ordered:
            for alias in e.aliases:
                owner = self._by_key.setdefault(name_key(alias), e)
                if owner.id != e.id:
                    self.conflicts.append(
                        f"alias {alias!r} of {e.name!r} already names {owner.name!r}"
                    )

    def find(self, name: str) -> Exercise | None:
        return self._by_key.get(name_key(name))

    def scoring(self, name: str, bodyweight: float) -> Scoring:
        exercise = self.find(name)
        if exercise is None:
            return Scoring(muscle_factor=UNKNOWN_FACTOR, bodyweight_kg=None)
        fraction = exercise.bodyweight_fraction
        return Scoring(
            muscle_factor=exercise.muscle_factor,
            bodyweight_kg=None if fraction is None else bodyweight * fraction,
        )

    def scorer(self, bodyweight: float) -> Scorer:
        return lambda _type, name: self.scoring(name, bodyweight)

    def unknown(self, names: Iterable[str]) -> list[str]:
        """The distinct names (first spelling seen, trimmed) that match nothing, sorted."""
        found: dict[str, str] = {}
        for name in names:
            if self.find(name) is None:
                found.setdefault(name_key(name), name.strip())
        return sorted(found.values())


def unknown_rows(names: Sequence[str]) -> list[dict[str, object]]:
    """public.exercises rows for names the catalogue doesn't know: the unknown-name defaults."""
    return [
        {"name": name, "category": UNKNOWN_CATEGORY, "muscle_factor": UNKNOWN_FACTOR}
        for name in names
    ]
