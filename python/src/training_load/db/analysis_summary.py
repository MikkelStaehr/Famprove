"""public.analysis_summary: the three answers on Analyse > Cykel (domain.cycling_answers), one
row per question. Rebuilt by compute as one upsert of all three rows (one request: a failed run
leaves the previous run's rows, never a mix)."""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.cycling_answers import Answer, Direction, Question, State

TABLE: Final = "analysis_summary"


class AnalysisSummaryRow(TypedDict):
    question: Question
    as_of: str  # ISO date: the run day
    computed_at: str  # ISO timestamptz
    state: State
    direction: Direction | None
    value: float | None
    value_date: str | None
    compare: float | None
    compare_date: str | None
    delta: float | None
    have_n: int | None
    need_n: int | None
    target: float | None
    target_since: str | None
    planned_n: int | None
    done_n: int | None
    verdict_text: str
    detail_text: str | None


def _iso(day: date | None) -> str | None:
    return None if day is None else day.isoformat()


def answer_row(a: Answer, *, today: date, computed_at: datetime) -> AnalysisSummaryRow:
    return AnalysisSummaryRow(
        question=a.question,
        as_of=today.isoformat(),
        computed_at=computed_at.isoformat(),
        state=a.state,
        direction=a.direction,
        value=a.value,
        value_date=_iso(a.value_date),
        compare=a.compare,
        compare_date=_iso(a.compare_date),
        delta=a.delta,
        have_n=a.have_n,
        need_n=a.need_n,
        target=a.target,
        target_since=_iso(a.target_since),
        planned_n=a.planned_n,
        done_n=a.done_n,
        verdict_text=a.verdict_text,
        detail_text=a.detail_text,
    )


def sync_answers(
    db: Postgrest, answers: Sequence[Answer], *, today: date, computed_at: datetime
) -> None:
    rows = [answer_row(a, today=today, computed_at=computed_at) for a in answers]
    db.upsert(TABLE, rows, on_conflict="question")
