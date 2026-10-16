"""The golden test's database (cleanup step 2, user 2026-10-16): a snapshot of the real tables in
tests/golden/inputs.json (git-ignored: personal data, the repo is public), loaded into an
in-memory PostgREST that orders like Postgres (numbers as numbers, NULLs last), so compute runs
on it as it does on Supabase. tests/golden_dump.py writes the snapshot; tests/test_golden.py
runs compute on it and compares every table it writes with tests/golden/expected.json."""

import json
from datetime import date
from pathlib import Path
from typing import Final

from conftest import PRIMARY_KEYS, InMemoryPostgrest, _matches
from training_load.db.client import Filters, JsonRow

GOLDEN_DIR: Final = Path(__file__).parent / "golden"
INPUTS: Final = GOLDEN_DIR / "inputs.json"
EXPECTED: Final = GOLDEN_DIR / "expected.json"
TABLES: Final = tuple(PRIMARY_KEYS)  # every table the in-memory db knows (compute's in and out)


def _order_key(value: object) -> tuple[int, float | str]:
    """Postgres ascending order: numbers by value, text by text, NULLs last."""
    if value is None:
        return (2, "")
    if isinstance(value, bool):
        return (0, float(value))
    if isinstance(value, int | float):
        return (0, float(value))
    return (1, str(value))


class GoldenPostgrest(InMemoryPostgrest):
    """InMemoryPostgrest with Postgres ordering (its parent orders every column as text)."""

    def select(
        self, table: str, *, columns: str, order: str, filters: Filters = ()
    ) -> list[JsonRow]:
        wanted = columns.split(",")
        rows = [r for r in self.tables[table] if _matches(r, filters)]
        rows.sort(key=lambda r: tuple(_order_key(r[c]) for c in order.split(",")))
        return [{c: r[c] for c in wanted} for r in rows]


def load_inputs() -> tuple[date, GoldenPostgrest]:
    """The snapshot's day and a db holding every table as it was then."""
    raw = json.loads(INPUTS.read_text(encoding="utf-8"))
    db = GoldenPostgrest()
    for table in TABLES:
        db.tables[table] = [dict(r) for r in raw["tables"].get(table, [])]
    return date.fromisoformat(raw["day"]), db
