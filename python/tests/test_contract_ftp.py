"""Contract (CLAUDE.md): the FTP check across the language boundary, both ways.
- web/tests/fixtures/ftp-status.json is Python's ftp_status rows as written (db.ftp.status_row):
  today's real case (not credible), a confirmed one (suppressed) and one without an FTP (all null).
  Regenerate: REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_ftp.py
- web/tests/fixtures/ftp-ack.json is the web's insert (its test holds the builder to it) and the row
  PostgREST returns for it; Python's parser must read that row.
"""

import json
import os
from datetime import UTC, date, datetime
from pathlib import Path

from training_load.db.ftp import ack_from_row, status_row
from training_load.domain.ftp_check import Effort, FtpAck, ftp_status

FIXTURES = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures"
STATUS = FIXTURES / "ftp-status.json"
ACK = FIXTURES / "ftp-ack.json"
AT = datetime(2026, 10, 15, 3, 0, tzinfo=UTC)
RIDES = [(date(2025, 9, 7), 250), (date(2026, 3, 21), 230), (date(2026, 10, 11), 230)]
WEEKLY = [Effort(221, date(2026, 5, 17)), Effort(203, date(2026, 8, 30))]


def producer() -> dict[str, object]:
    def row(best: int | None, ack: FtpAck | None, ftp: int | None = 230) -> object:
        status = ftp_status(
            ftp_w=ftp,
            eftp_w=183 if ftp is not None else None,
            best_42d=None if best is None else Effort(best, date(2026, 9, 20)),
            weekly=WEEKLY,
            rides=RIDES,
            ack=ack,
            today=date(2026, 10, 15),
        )
        return status_row(status, checked_at=AT)

    confirmed = FtpAck("confirmed", 230, 183, datetime(2026, 10, 14, 19, 0, tzinfo=UTC))
    rows = {
        "quiet": row(202, None),
        "suppressed": row(210, confirmed),
        "none": row(None, None, None),
    }
    loaded: dict[str, object] = json.loads(json.dumps(rows))  # as PostgREST returns JSON
    return loaded


def test_the_web_status_fixture_is_pythons_current_output() -> None:
    rows = producer()
    if os.environ.get("REGENERATE_CONTRACT") == "1":
        STATUS.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(STATUS.read_text(encoding="utf-8")) == rows, (
        "web/tests/fixtures/ftp-status.json is stale: "
        "REGENERATE_CONTRACT=1 uv run pytest tests/test_contract_ftp.py"
    )


def test_python_reads_the_row_the_web_writes() -> None:
    fixture = json.loads(ACK.read_text(encoding="utf-8"))
    insert, row = fixture["insert"], fixture["row"]
    assert {k: row[k] for k in insert} == insert  # the stored row is the web's insert + defaults
    ack = ack_from_row(row)
    assert (ack.choice, ack.ftp_w, ack.eftp_w) == ("confirmed", 230, 183)
    assert ack.at == datetime(2026, 10, 15, 8, 0, 0, 123456, tzinfo=UTC)
