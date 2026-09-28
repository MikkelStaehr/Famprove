"""collect-strength and compute end to end: fake Drive over FakeSend, in-memory PostgREST."""

from datetime import date

import pytest

from conftest import (
    BLOK_11,
    BLOK_12,
    FIXED_TODAY,
    SYNTHETIC_BODYWEIGHT,
    SYNTHETIC_SHEET_ID,
    Call,
    FakeResponse,
    FakeSend,
    InMemoryPostgrest,
    raw_ride,
)
from training_load.cli import collect_strength, compute
from training_load.config import GoogleSettings
from training_load.db.activities import upsert_activities
from training_load.domain.load import ctl_atl
from training_load.sources.google_drive import GOOGLE_SHEET_MIME, XLSX_MIME
from training_load.sources.intervals import parse_activities

GOOGLE = GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={})


def drive(workbook: bytes, mime: str = GOOGLE_SHEET_MIME) -> FakeSend:
    def handler(call: Call) -> FakeResponse:
        assert call.method == "GET", "Drive must only ever be read"
        assert call.headers["Authorization"] == "Bearer fake-token"
        if dict(call.params or []).get("fields") == "mimeType":
            return FakeResponse(body={"mimeType": mime})
        return FakeResponse(raw=workbook)

    return FakeSend(handler=handler)


@pytest.fixture(autouse=True)
def fake_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(collect_strength, "access_token", lambda _info: "fake-token")


@pytest.mark.parametrize(("mime", "path_suffix"), [(GOOGLE_SHEET_MIME, "/export"), (XLSX_MIME, "")])
def test_collect_strength_exports_parses_and_replaces(
    db: InMemoryPostgrest, workbook_bytes: bytes, mime: str, path_suffix: str
) -> None:
    send = drive(workbook_bytes, mime)
    for _ in range(2):  # idempotent: the second run replaces, never duplicates
        written = collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=send, db=db)
    assert written == 55
    assert len(db.tables["strength_sets"]) == 55
    assert send.calls[1].url.endswith(f"/files/{SYNTHETIC_SHEET_ID}{path_suffix}")


def test_collect_strength_rejects_non_xlsx_payload(db: InMemoryPostgrest) -> None:
    with pytest.raises(ValueError, match="non-xlsx"):
        collect_strength.run(GOOGLE, bodyweight=80.0, send=drive(b"<html>"), db=db)


def test_compute_rebuilds_daily_load_and_blocks(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook_bytes), db=db)
    rides = [
        raw_ride("i1", "2026-01-01T18:00:00", load=100),
        raw_ride("i2", "2026-02-05T07:00:00", load=60),
    ]
    upsert_activities(db, parse_activities(rides).cycling)
    db.tables["daily_load"] = [{"date": "2025-12-31"}]  # stale row outside the range

    summary = compute.run(db, strength_k=0.02, today=FIXED_TODAY)

    rows = {r["date"]: r for r in db.tables["daily_load"]}
    assert summary.days == len(rows) == (FIXED_TODAY - date(2026, 1, 1)).days + 1
    assert "2025-12-31" not in rows
    assert rows["2026-01-01"]["ctl"] == pytest.approx(ctl_atl([100.0])[0].ctl)
    feb5 = rows["2026-02-05"]
    assert feb5["cycling_tss"] == 60.0
    assert feb5["strength_tss"] == pytest.approx((3 * 90.7 + 3 * 307.2) * 0.02)
    assert feb5["total_tss"] == pytest.approx(60.0 + (3 * 90.7 + 3 * 307.2) * 0.02)
    assert {(b["name"], b["deload_start"]) for b in db.tables["blocks"]} == {
        (BLOK_11, "2026-02-02"),
        (BLOK_12, "2026-03-16"),
    }
