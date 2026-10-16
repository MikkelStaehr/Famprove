"""Snapshot the real tables for the golden test (read-only against Supabase).

Run from python/:  PYTHONIOENCODING=utf-8 uv run python tests/golden_dump.py
Writes tests/golden/inputs.json (git-ignored: personal data; the repo is public). Then record the
goldens on the code before a refactor:  REGENERATE_GOLDEN=1 uv run pytest tests/test_golden.py
"""

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from conftest import PRIMARY_KEYS
from golden_db import GOLDEN_DIR, INPUTS, TABLES  # after the path insert
from training_load.config import compute_config, load_dotenv_file
from training_load.db.client import Postgrest
from training_load.domain.dates import today_local
from training_load.http import requests_send


def main() -> int:
    load_dotenv_file()
    config = compute_config(os.environ)
    db = Postgrest(config.supabase.url, config.supabase.service_key, requests_send())
    tables = {t: db.select(t, columns="*", order=",".join(PRIMARY_KEYS[t])) for t in TABLES}
    GOLDEN_DIR.mkdir(exist_ok=True)
    day = today_local(datetime.now(UTC))
    INPUTS.write_text(
        json.dumps({"day": day.isoformat(), "tables": tables}, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    print(f"{INPUTS}: day {day}, " + ", ".join(f"{t} {len(r)}" for t, r in tables.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
