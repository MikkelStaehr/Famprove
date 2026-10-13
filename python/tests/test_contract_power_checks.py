"""Contract: the power-check data Python writes is the web parser's fixture (CLAUDE.md).
web/tests/fixtures/power_checks.json holds a real activities row with a data_warning (both rules)
and a real app_notices row, from db.activities.to_row and db.app_notices.notice_row. Regenerate:
    REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_power_checks.py
"""

import json
import os
from datetime import UTC, date, datetime
from pathlib import Path

from training_load.db.activities import to_row
from training_load.db.app_notices import notice_row
from training_load.domain.cycling import CyclingActivity
from training_load.domain.power_check import FTP_NOTICE_KIND, Spike, data_warning, ftp_notice

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "power_checks.json"


def producer() -> dict[str, object]:
    warning = data_warning(1650, 1210.0, Spike(watts=1650, above=900, at_s=3725))
    ride = CyclingActivity(
        id="i500",
        start_date_local=datetime(2026, 10, 11, 9, 0),
        type="Ride",
        name="Morning Ride",
        training_load=139,
        weighted_avg_watts=206,
        intensity_pct=89.6,
        ftp=230,
        moving_time_s=6240,
        elapsed_time_s=6500,
        power_load=139,
        hr_load=None,
        device_name="HAMMERHEAD Karoo",
        data_warning=warning,
    )
    message = ftp_notice(230, 183)
    assert message is not None
    notice = notice_row(
        FTP_NOTICE_KIND,
        message,
        today=date(2026, 10, 13),
        now=datetime(2026, 10, 13, 6, 0, tzinfo=UTC),
    )
    rows: dict[str, object] = json.loads(json.dumps({"activity": to_row(ride), "notice": notice}))
    return rows  # as PostgREST returns JSON


def test_the_web_fixture_is_pythons_current_output() -> None:
    rows = producer()
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        FIXTURE.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/power_checks.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_power_checks.py"
    )
