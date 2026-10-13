"""Contract: the planned_sets rows Python writes are the web parser's fixture (CLAUDE.md).
web/tests/fixtures/planned_sets.json is the real producer's output (domain.planned_sets +
db.planned_sets) on the bench of 2026-10-13: a suggestion (82.5), a capped one (75, uncapped
72.5) and a set without one (a %-row). Regenerate:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_planned_sets.py
"""

import json
import os
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from training_load.db.planned_sets import to_row
from training_load.domain.exercises import Catalog, Exercise
from training_load.domain.planned_sets import planned_sets
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import KgStatus, SetKey, set_key

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "planned_sets.json"
RUN_WEEK = date(2026, 10, 12)
RUN_AT = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)
BASE = StrengthSet(
    sheet_id="sheet",
    block="Program - blok 12",
    sheet_row=28,
    week=10,
    set_no=1,
    week_start=RUN_WEEK,
    session=1,
    type="BENCH",
    name="Bænk",
    reps=3.0,
    logged_kg=None,
    kg=0.0,
    bodyweight=False,
    rpe=None,
    score=0.0,
)


def producer() -> dict[str, object]:
    rows = [(28, 3.0, "RPE 6", 82.5), (29, 3.0, "RPE 7", 85.0), (30, 8.0, "RPE 5 - 7", 78.5),
            (31, 5.0, "-10%", 72.5)]  # fmt: skip
    sets: list[StrengthSet] = []
    statuses: dict[SetKey, KgStatus] = {}
    for row, reps, rx, kg in rows:
        done = replace(BASE, sheet_row=row, reps=reps, prescribed=rx, logged_kg=kg, kg=kg,
                       week=9, week_start=RUN_WEEK - timedelta(weeks=1))  # fmt: skip
        plan = replace(BASE, sheet_row=row, reps=reps, prescribed=rx)
        sets += [done, plan]
        statuses |= {set_key(done): "lifted", set_key(plan): "planned"}
    catalog = Catalog([Exercise(3, "Bænk", (), "main", "BENCH", 1.0, None, True, 1.0)])
    planned = planned_sets(sets, catalog, statuses, today=date(2026, 10, 13))
    by_row = {p.sheet_row: to_row(p, RUN_AT) for p in planned}
    out: dict[str, object] = json.loads(
        json.dumps({"suggestion": by_row[28], "capped": by_row[30], "none": by_row[31]})
    )
    return out


def test_the_capped_row_carries_its_uncapped_suggestion() -> None:
    rows = producer()
    assert isinstance(rows["capped"], dict) and isinstance(rows["suggestion"], dict)
    assert (rows["capped"]["suggested_kg"], rows["capped"]["uncapped_kg"]) == (75.0, 72.5)
    assert (rows["suggestion"]["suggested_kg"], rows["suggestion"]["uncapped_kg"]) == (82.5, None)


def test_the_web_fixture_is_pythons_current_output() -> None:
    rows = producer()
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/planned_sets.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_planned_sets.py"
    )
