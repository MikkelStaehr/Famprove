"""public.exercise_feel: one Danish line per exercise with 4+ rated sets (domain.set_feedback),
for Analyse > Styrke. Rebuilt by compute: upsert with this run's computed_at, then delete older
rows (an exercise that no longer qualifies)."""

from collections.abc import Sequence
from datetime import datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.set_feedback import Feel

TABLE: Final = "exercise_feel"


class ExerciseFeelRow(TypedDict):
    exercise_id: int
    rated_n: int
    lighter_n: int
    expected_n: int
    harder_n: int
    verdict_text: str
    computed_at: str


def feel_row(f: Feel, computed_at: datetime) -> ExerciseFeelRow:
    return ExerciseFeelRow(
        exercise_id=f.exercise_id,
        rated_n=f.rated_n,
        lighter_n=f.lighter_n,
        expected_n=f.expected_n,
        harder_n=f.harder_n,
        verdict_text=f.verdict_text,
        computed_at=computed_at.isoformat(),
    )


def sync_exercise_feel(db: Postgrest, feels: Sequence[Feel], *, computed_at: datetime) -> None:
    if computed_at.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    if feels:
        db.upsert(TABLE, [feel_row(f, computed_at) for f in feels], on_conflict="exercise_id")
    db.delete(TABLE, [("computed_at", f"lt.{computed_at.isoformat()}")])
