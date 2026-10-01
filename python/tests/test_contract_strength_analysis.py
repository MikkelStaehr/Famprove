"""Contract: the strength_weeks rows Python writes are the web parser's fixture (CLAUDE.md).
web/tests/fixtures/strength_weeks.json is the real producer's output (domain.strength_analysis
+ db.strength_analysis.week_row) on synthetic sets; the web tests (task e2) parse every row.
When the producer changes, regenerate it:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_strength_analysis.py
Edge cases kept in it: a pre_log week, a lifted week, a week with nothing lifted (0), a week
between blocks (no block), both RPE sources, a block best per phase and a null e1RM.
"""

import json
import os
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from training_load.db.strength_analysis import StrengthWeekRow, week_row
from training_load.domain.strength import Block, StrengthSet
from training_load.domain.strength_analysis import KgStatus, set_key, strength_weeks

MakeSet = Callable[..., StrengthSet]
FIXTURE = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "strength_weeks.json"
RUN_AT = datetime(2026, 10, 1, 3, 0, tzinfo=UTC)
B11, B12 = "Program - blok 11", "Program - blok 12 (offseason)"
W1, W12 = date(2026, 8, 10), date(2026, 8, 31)


def producer_rows(make_set: MakeSet) -> list[StrengthWeekRow]:
    def s(block: str, week: date, row: int, **changes: object) -> StrengthSet:
        values: dict[str, object] = {
            "block": block,
            "week_start": week,
            "sheet_row": row,
            "type": "SQUAT",
            "name": "Squat",
            "reps": 5.0,
            "logged_kg": 140.0,
            "prescribed": "RPE 6.5",
        }
        return make_set(**(values | changes))

    sets = [
        s(B11, W1, 1),  # pre_log, prescribed RPE
        s(B11, W1, 2, type="BENCH", name="Bænk", logged_kg=80.0, prescribed="75%"),  # no e1RM
        s(B11, W1 + timedelta(days=7), 1, logged_kg=150.0),  # blok 11 best
        s(B12, W12, 1, type="DEADLIFT", name="Dødløft", logged_kg=150.0, logged_rpe=7.0),
    ]
    statuses: dict[tuple[str, str, int, int, int], KgStatus] = {
        set_key(x): ("lifted" if x.block == B12 else "pre_log") for x in sets
    }
    blocks = [
        Block("s", B11, 11, W1, W1 + timedelta(days=13), None),
        Block("s", B12, 12, W12, W12 + timedelta(days=6), None),
    ]
    weeks = strength_weeks(sets, statuses, blocks, today=W12 + timedelta(days=2)).weeks
    return [week_row(w, RUN_AT) for w in weeks]


def test_the_web_fixture_is_pythons_current_output(make_set: MakeSet) -> None:
    rows: object = json.loads(json.dumps(producer_rows(make_set)))  # as PostgREST returns JSON
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8", newline="\n")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/strength_weeks.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_strength_analysis.py"
    )


def test_the_fixture_keeps_its_edge_cases(make_set: MakeSet) -> None:
    rows = producer_rows(make_set)
    assert {r["status"] for r in rows} == {"pre_log", "lifted", None}
    assert {r["e1rm_rpe_source"] for r in rows} == {"prescribed", "logged", None}
    assert {r["phase"] for r in rows} == {"in_season", "off_season", None}  # None: between blocks
    assert any(r["block"] is None for r in rows)
    assert {(r["block"], r["lift"]) for r in rows if r["is_block_best"]} == {
        (B11, "SQUAT"),
        (B12, "DEADLIFT"),
    }
    assert any(r["sets_lifted"] > 0 and r["e1rm_kg"] is None for r in rows)  # % row: no e1RM
