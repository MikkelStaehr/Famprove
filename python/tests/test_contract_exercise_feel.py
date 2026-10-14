"""Contract: the exercise_feel rows Python writes are the web parser's fixture (CLAUDE.md).
web/tests/fixtures/exercise_feel.json is db.exercise_feel.feel_row's output for the three kinds
of line, with the exercise name and variant name PostgREST embeds (exercises(name),
exercise_variants(display_name); null without a variant). Regenerate:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_exercise_feel.py
"""

import json
import os
from datetime import UTC, date, datetime
from pathlib import Path

from training_load.db.exercise_feel import feel_row
from training_load.domain.set_feedback import LoggedSet, exercise_feel
from training_load.domain.strength import StrengthSet

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "exercise_feel.json"
RUN_AT = datetime(2026, 10, 13, 18, 0, tzinfo=UTC)
NAMES = {2: "Bænk", 8: "Low incline DB press", 9: "Lat pulldowns", 16: "Bicep of choice"}
VARIANT_NAMES = {7: "DB Preacher Curl"}


def rated(exercise_id: int, felts: list[int], row: int = 30) -> list[LoggedSet]:
    return [
        LoggedSet(date(2026, 10, 13), 1, row, n + 1, exercise_id, f"2026-10-13T08:{n:02d}:00+00:00",
                  False, felt, None)
        for n, felt in enumerate(felts)
    ]  # fmt: skip


def variant_set(set_no: int) -> StrengthSet:
    """A sheet set at row 40 done as the variant 7 (2026-10-14): its logged sets take it."""
    return StrengthSet(sheet_id="s", block="Program - blok 12", sheet_row=40, week=3, set_no=set_no,
                       type="BICEPS", name="Bicep of choice", reps=10.0, logged_kg=9.0, kg=9.0,
                       bodyweight=False, rpe=8.0, score=1.0, week_start=date(2026, 10, 12),
                       session=1, variant_id=7)  # fmt: skip


def producer() -> list[dict[str, object]]:
    logged = [*rated(2, [-1, -1, -1, 0]), *rated(8, [0, 0, 1, 0]), *rated(9, [1, 1, 1, 1]),
              *rated(16, [-1, 0, -1, -1], row=40)]  # fmt: skip
    offsets = {(2, None): 5.0, (8, None): None, (9, None): -2.5, (16, 7): None}
    feels = exercise_feel(logged, offsets, [variant_set(n) for n in (1, 2, 3, 4)])
    rows = [
        {
            **feel_row(f, RUN_AT),
            "exercises": {"name": NAMES[f.exercise_id]},
            "exercise_variants": None
            if f.variant_id is None
            else {"display_name": VARIANT_NAMES[f.variant_id]},
        }
        for f in feels
    ]
    out: list[dict[str, object]] = json.loads(json.dumps(rows))
    return out


def test_the_web_fixture_is_pythons_current_output() -> None:
    rows = producer()
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/exercise_feel.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_exercise_feel.py"
    )
