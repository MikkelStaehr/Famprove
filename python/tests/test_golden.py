"""Golden test for cleanup step 2 (user, 2026-10-16): no behaviour change. compute runs on a
snapshot of the real tables (tests/golden_db.py) for the snapshot's day and the 4 weeks before
it, and every table it writes must equal the goldens recorded on the code before the refactor:
daily_load (TSS, CTL, ATL, TSB per day), planned_sets (suggestions, today's kg, rest), and the
rest of compute's output. Tables it doesn't write must stay as they were.

Skipped without the snapshot (git-ignored, so CI never has it). Record the goldens on the old
code:  REGENERATE_GOLDEN=1 uv run pytest tests/test_golden.py"""

import json
import os
from datetime import UTC, datetime, time, timedelta
from typing import Final

import pytest

from golden_db import EXPECTED, INPUTS, TABLES, load_inputs
from training_load.cli import compute
from training_load.db.client import JsonRow

STRENGTH_K: Final = 0.035  # the repository variable since 2026-10-02
WEEKS_BACK: Final = 4
OUTPUTS: Final = (
    "daily_load",
    "planned_sets",
    "strength_sessions",
    "strength_sets",  # score_final / rpe_final
    "blocks",
    "strength_weeks",
    "strength_set_kg",
    "exercise_feel",
    "daily_projection",
    "forecast_log",
    "ride_metrics",
    "cycling_weeks",
    "analysis_summary",
)

pytestmark = pytest.mark.skipif(not INPUTS.exists(), reason="no golden snapshot (git-ignored)")


def _canonical(rows: list[JsonRow]) -> list[str]:
    """Rows as sorted JSON lines, so order of writing never matters, values always do."""
    return sorted(json.dumps(r, sort_keys=True, ensure_ascii=False, default=str) for r in rows)


def _run_all() -> dict[str, dict[str, list[str]]]:
    day, _ = load_inputs()
    out: dict[str, dict[str, list[str]]] = {}
    for back in range(WEEKS_BACK + 1):
        today = day - timedelta(weeks=back)
        _, db = load_inputs()  # each run from the snapshot, not from the previous run
        before = {t: _canonical(db.tables[t]) for t in TABLES}
        computed_at = datetime.combine(today, time(5, 7), tzinfo=UTC)
        compute.run(db, strength_k=STRENGTH_K, today=today, computed_at=computed_at)
        after = {t: _canonical(db.tables[t]) for t in TABLES}
        untouched = [t for t in TABLES if t not in OUTPUTS and after[t] != before[t]]
        assert untouched == [], f"compute wrote tables outside OUTPUTS: {untouched}"
        out[today.isoformat()] = {t: after[t] for t in OUTPUTS}
    return out


def test_compute_output_is_identical_to_the_goldens() -> None:
    got = _run_all()
    if os.environ.get("REGENERATE_GOLDEN") == "1":
        EXPECTED.write_text(json.dumps(got, ensure_ascii=False, indent=0), encoding="utf-8")
        pytest.skip(f"goldens written to {EXPECTED}")
    expected: dict[str, dict[str, list[str]]] = json.loads(EXPECTED.read_text(encoding="utf-8"))
    assert sorted(got) == sorted(expected)
    for day, tables in expected.items():
        for table, rows in tables.items():
            mine = got[day][table]
            if mine != rows:
                extra = [r for r in mine if r not in set(rows)][:3]
                missing = [r for r in rows if r not in set(mine)][:3]
                pytest.fail(
                    f"{day} {table}: {len(mine)} rows vs {len(rows)} golden;"
                    f" new {extra}; gone {missing}"
                )
