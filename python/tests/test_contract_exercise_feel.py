"""Contract: the exercise_feel rows Python writes are the web parser's fixture (CLAUDE.md).
web/tests/fixtures/exercise_feel.json is db.exercise_feel.feel_row's output for the three kinds
of line, with the exercise name PostgREST embeds (exercises(name)). Regenerate:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_exercise_feel.py
"""

import json
import os
from datetime import UTC, date, datetime
from pathlib import Path

from training_load.db.exercise_feel import feel_row
from training_load.domain.set_feedback import LoggedSet, exercise_feel

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "exercise_feel.json"
RUN_AT = datetime(2026, 10, 13, 18, 0, tzinfo=UTC)
NAMES = {2: "Bænk", 8: "Low incline DB press", 9: "Lat pulldowns"}


def rated(exercise_id: int, felts: list[int]) -> list[LoggedSet]:
    return [
        LoggedSet(date(2026, 10, 13), 1, 30, n + 1, exercise_id, f"2026-10-13T08:{n:02d}:00+00:00",
                  False, felt, None)
        for n, felt in enumerate(felts)
    ]  # fmt: skip


def producer() -> list[dict[str, object]]:
    logged = [*rated(2, [-1, -1, -1, 0]), *rated(8, [0, 0, 1, 0]), *rated(9, [1, 1, 1, 1])]
    feels = exercise_feel(logged, {2: 5.0, 8: None, 9: -2.5})
    rows = [{**feel_row(f, RUN_AT), "exercises": {"name": NAMES[f.exercise_id]}} for f in feels]
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
