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

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final, Protocol

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
    per_side: bool = (
        False  # the sheet's reps are per side: the score counts both (user, 2026-10-14)
    )
    kg_per_dumbbell: bool = False  # the logged kg is per dumbbell, two held: external load x 2


@dataclass(frozen=True, slots=True)
class Scoring:
    """What the strength formula needs to know about one sheet row's exercise."""

    muscle_factor: float
    bodyweight_kg: float | None  # BODYWEIGHT x fraction; None: not a bodyweight exercise
    sides: int = 1  # 2: reps are per side, the score counts both (exercises.per_side)
    kg_factor: int = 1  # 2: the logged kg is per dumbbell, two held (exercises.kg_per_dumbbell)


class Scorer(Protocol):
    """(sheet TYPE, exercise name[, normalised variant]) -> Scoring. The catalogue scores by name
    and variant only; the TYPE is there for callers that score by the sheet's TYPE."""

    def __call__(self, sheet_type: str, name: str, variant: str | None = None, /) -> Scoring: ...


@dataclass(frozen=True, slots=True)
class ExerciseVariant:
    """A row of public.exercise_variants (user, 2026-10-14): a variant of an exercise written in
    the sheet's NOTES (any text but an "N:" remark; "V:" optional since 2026-10-15). Every
    scoring field is an override; None = inherit."""

    id: int
    exercise_id: int
    name: str  # normalised (variant_key)
    display_name: str
    aliases: tuple[str, ...] = ()
    muscle_factor: float | None = None
    bodyweight_fraction: float | None = None
    no_bodyweight: bool = False  # True: no bodyweight even if the exercise has a fraction
    per_side: bool | None = None
    kg_per_dumbbell: bool | None = None
    suggests: bool = True  # False: no suggested kg (e.g. a multi-exercise variant)


def variant_key(text: str) -> str:
    """The normalised variant name: trimmed, lower case, whitespace collapsed (user, 2026-10-14)."""
    return " ".join(text.split()).lower()


def name_key(name: str) -> str:
    """The matching key: trimmed, lower case (as SQL's lower(btrim(name)))."""
    return name.strip().lower()


class Catalog:
    """Name and alias look-up over the catalogue rows.

    A canonical name always wins over an alias. When an alias names a different exercise than
    an earlier one (or another exercise's name), the first by id keeps it and the clash is listed
    in ``conflicts`` for a warning: the user has to fix the table, the run doesn't guess silently.
    """

    def __init__(
        self, exercises: Iterable[Exercise], variants: Iterable[ExerciseVariant] = ()
    ) -> None:
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

        # Variants per exercise by name and alias (normalised); a clash keeps the first by id.
        self._variants: dict[tuple[int, str], ExerciseVariant] = {}
        ordered_variants = sorted(variants, key=lambda v: v.id)
        for v in ordered_variants:
            self._variants.setdefault((v.exercise_id, variant_key(v.name)), v)
        for v in ordered_variants:
            for alias in v.aliases:
                holder = self._variants.setdefault((v.exercise_id, variant_key(alias)), v)
                if holder.id != v.id:
                    self.conflicts.append(
                        f"variant alias {alias!r} of {v.name!r} already names {holder.name!r}"
                    )

    def find(self, name: str) -> Exercise | None:
        return self._by_key.get(name_key(name))

    def variant_by_id(self, variant_id: int | None) -> ExerciseVariant | None:
        if variant_id is None:
            return None
        return next((v for v in self._variants.values() if v.id == variant_id), None)

    @staticmethod
    def names_itself(exercise: Exercise, variant: str) -> bool:
        """The exercise's own name or one of its aliases in NOTES names no variant (ukendt)."""
        key = variant_key(variant)
        return key in {variant_key(n) for n in (exercise.name, *exercise.aliases)}

    def find_variant(self, name: str, variant: str | None) -> ExerciseVariant | None:
        """The stored variant (by name or alias) of the exercise ``name``; None when the exercise
        or the variant is unknown, ``variant`` is None (ukendt) or names the exercise itself."""
        exercise = self.find(name)
        if exercise is None or variant is None or self.names_itself(exercise, variant):
            return None
        return self._variants.get((exercise.id, variant_key(variant)))

    def scoring(self, name: str, bodyweight: float, variant: str | None = None) -> Scoring:
        """The exercise's scoring inputs, each overridden by the variant's when it sets one
        (user, 2026-10-14). An unknown variant inherits everything."""
        exercise = self.find(name)
        if exercise is None:
            return Scoring(muscle_factor=UNKNOWN_FACTOR, bodyweight_kg=None)
        v = self.find_variant(name, variant)
        fraction = exercise.bodyweight_fraction
        if v is not None and v.no_bodyweight:
            fraction = None
        elif v is not None and v.bodyweight_fraction is not None:
            fraction = v.bodyweight_fraction
        per_side = exercise.per_side if v is None or v.per_side is None else v.per_side
        per_dumbbell = (
            exercise.kg_per_dumbbell
            if v is None or v.kg_per_dumbbell is None
            else v.kg_per_dumbbell
        )
        return Scoring(
            muscle_factor=(
                exercise.muscle_factor if v is None or v.muscle_factor is None else v.muscle_factor
            ),
            bodyweight_kg=None if fraction is None else bodyweight * fraction,
            sides=2 if per_side else 1,
            kg_factor=2 if per_dumbbell else 1,
        )

    def scorer(self, bodyweight: float) -> Scorer:
        def score(_type: str, name: str, variant: str | None = None, /) -> Scoring:
            return self.scoring(name, bodyweight, variant)

        return score

    def unknown_variants(
        self, pairs: Iterable[tuple[str, str | None, str | None]]
    ) -> list[tuple[int, str, str]]:
        """(exercise id, normalised name, display name) of the variants seen in (exercise name,
        variant, display) that the catalogue doesn't store yet, for a known exercise; distinct,
        the first display spelling wins."""
        found: dict[tuple[int, str], str] = {}
        for name, variant, display in pairs:
            exercise = self.find(name)
            if exercise is None or variant is None or self.names_itself(exercise, variant):
                continue
            if self.find_variant(name, variant) is None:
                found.setdefault((exercise.id, variant_key(variant)), display or variant)
        return [(eid, key, shown) for (eid, key), shown in sorted(found.items())]

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
