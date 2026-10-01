"""collect-strength and compute end to end: fake Drive over FakeSend, in-memory PostgREST."""

from dataclasses import replace
from datetime import UTC, date, datetime
from typing import cast

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
from training_load.db.strength_activities import upsert_strength_activities
from training_load.domain.load import ctl_atl
from training_load.sources.google_drive import GOOGLE_SHEET_MIME, XLSX_MIME
from training_load.sources.intervals import parse_activities
from training_load.sources.strength_sheet import ParsedSet

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
    tempo = next(r for r in db.tables["strength_sets"] if r["name"] == "Tempo bench")
    assert (tempo["week_start"], tempo["session"]) == ("2026-02-02", 2)
    assert "date" not in tempo
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
        # Week of 2026-02-02: sessions 1 and 2 are done on Tue and Thu, whatever the sheet says.
        raw_ride("g1", "2026-02-03T19:00:00", load=19, kind="WeightTraining"),
        raw_ride("g2", "2026-02-05T19:00:00", load=17, kind="WeightTraining"),
    ]
    parsed = parse_activities(rides)
    upsert_activities(db, parsed.cycling)
    upsert_strength_activities(db, parsed.strength)
    db.tables["daily_load"] = [{"date": "2025-12-31"}]  # stale row outside the range

    run_at = datetime(2026, 3, 15, 3, 0, tzinfo=UTC)
    summary = compute.run(db, strength_k=0.02, today=FIXED_TODAY, computed_at=run_at)

    rows = {r["date"]: r for r in db.tables["daily_load"]}
    assert summary.days == len(rows) == (FIXED_TODAY - date(2026, 1, 1)).days + 1
    assert "2025-12-31" not in rows
    assert rows["2026-01-01"]["ctl"] == pytest.approx(ctl_atl([100.0])[0].ctl)
    assert {r["computed_at"] for r in rows.values()} == {run_at.isoformat()}
    assert rows["2026-01-01"]["ctl_ramp_7d"] is None
    jan1_ctl, jan8_ctl = rows["2026-01-01"]["ctl"], rows["2026-01-08"]["ctl"]
    assert isinstance(jan1_ctl, float) and isinstance(jan8_ctl, float)
    assert rows["2026-01-08"]["ctl_ramp_7d"] == pytest.approx(jan8_ctl - jan1_ctl)
    assert rows["2026-02-02"]["strength_tss"] == 0.0  # the sheet's DAY 1 date: no activity
    assert rows["2026-02-03"]["strength_tss"] == pytest.approx(
        (3 * 336.8 + 3 * 264.6 + 2 * 72.0 + 3 * 86.4) * 0.02
    )
    assert rows["2026-02-03"]["cycling_tss"] == 0.0  # WeightTraining load never counts as cycling
    feb5 = rows["2026-02-05"]
    assert feb5["cycling_tss"] == 60.0
    assert feb5["strength_tss"] == pytest.approx((3 * 90.7 + 3 * 307.2) * 0.02)
    assert feb5["total_tss"] == pytest.approx(60.0 + (3 * 90.7 + 3 * 307.2) * 0.02)
    assert {(b["name"], b["deload_start"]) for b in db.tables["blocks"]} == {
        (BLOK_11, "2026-02-02"),
        (BLOK_12, None),  # week 2 has kg but starts after today
    }
    assert (summary.sessions_done, summary.extra_sessions) == (2, 0)
    first_week = {
        r["session"]: r["date"]
        for r in db.tables["strength_sessions"]
        if r["week_start"] == "2026-02-02"
    }
    assert first_week == {1: "2026-02-03", 2: "2026-02-05"}

    projection = sorted(str(r["date"]) for r in db.tables["daily_projection"])
    assert (
        len(projection) == 56 and projection[0] == "2026-03-16" and projection[-1] == "2026-05-10"
    )
    assert max(str(r["date"]) for r in db.tables["daily_load"]) == FIXED_TODAY.isoformat()

    tables = ("daily_load", "strength_sessions", "daily_projection")
    before = {t: sorted(map(str, db.tables[t])) for t in tables}
    compute.run(db, strength_k=0.02, today=FIXED_TODAY, computed_at=run_at)
    after = {t: sorted(map(str, db.tables[t])) for t in tables}
    assert before == after  # idempotent


def ok_set(**overrides: object) -> ParsedSet:
    base: dict[str, object] = {
        "date": date(2026, 2, 2),
        "block": BLOK_11,
        "row": 9,
        "week": 1,
        "section": 1,
        "type": "SQUAT",
        "name": "Squat",
        "set": 1,
        "reps": 5.0,
        "logged_kg": 100.0,
        "kg": 100.0,
        "bodyweight": False,
        "rpe": 7.0,
        "score": 100.0,
        "prescribed": "RPE 7",
        "sets_text": "1",
        "reps_text": "5",
        "e1rm": None,
        "raw": {},
        "logged_rpe": None,
    }
    return cast(ParsedSet, base | overrides)


@pytest.mark.parametrize("reps", [None, "AMRAP", float("nan"), True])
def test_bad_numbers_fail_before_anything_is_deleted(
    db: InMemoryPostgrest, workbook_bytes: bytes, monkeypatch: pytest.MonkeyPatch, reps: object
) -> None:
    collect_strength.run(GOOGLE, bodyweight=80.0, send=drive(workbook_bytes), db=db)
    monkeypatch.setattr(
        collect_strength,
        "parse_all",
        lambda _x, _bw, _issues=None, counts_issues=None: [ok_set(), ok_set(reps=reps, row=11)],
    )
    with pytest.raises(ValueError, match="row 11 week 1: reps is not a number"):
        collect_strength.run(GOOGLE, bodyweight=80.0, send=drive(workbook_bytes), db=db)
    assert len(db.tables["strength_sets"]) == 55  # previous rows untouched


def test_tabs_without_block_number_are_skipped(
    db: InMemoryPostgrest, workbook_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    template = ok_set(block="Program - blok skabelon")
    monkeypatch.setattr(
        collect_strength,
        "parse_all",
        lambda _x, _bw, _issues=None, counts_issues=None: [ok_set(), template],
    )
    assert collect_strength.run(GOOGLE, bodyweight=80.0, send=drive(workbook_bytes), db=db) == 1
    assert {r["block"] for r in db.tables["strength_sets"]} == {BLOK_11}


def analysed_ride(activity_id: str, start: str, **extra: object) -> dict[str, object]:
    return {
        **raw_ride(activity_id, start, kind="Ride"),
        "average_heartrate": 150,
        "distance": 40_000.0,
        "device_watts": True,
        "icu_rolling_ftp": 200,
        **extra,
    }


def test_compute_analyses_rides_since_2025_without_touching_daily_load(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook_bytes), db=db)
    rides = [
        analysed_ride("i1", "2025-06-01T09:00:00"),  # analysis only: before SERIES_START
        analysed_ride("i2", "2026-01-01T18:00:00", icu_training_load=100),
        analysed_ride("i3", "2026-03-01T10:00:00", moving_time=60),  # too short
    ]
    upsert_activities(db, parse_activities(rides).cycling)
    run_at = datetime(2026, 3, 15, 3, 0, tzinfo=UTC)

    summary = compute.run(db, strength_k=0.02, today=FIXED_TODAY, computed_at=run_at)

    load = {str(r["date"]): r for r in db.tables["daily_load"]}
    assert min(load) == "2026-01-01" and load["2026-01-01"]["ctl"] == pytest.approx(
        ctl_atl([100.0])[0].ctl
    )  # the 2025 ride does not seed CTL
    assert summary.ignored_outside_range == 0
    metrics = {r["activity_id"]: r for r in db.tables["ride_metrics"]}
    assert set(metrics) == {"i1", "i2", "i3"} and summary.rides_analysed == 3
    assert metrics["i3"]["exclusion"] == "too_short"
    assert metrics["i1"]["eftp_ok"] and metrics["i1"]["rolling_ftp_w"] == 200
    assert summary.rides_excluded == {"too_short": 1}
    weeks = sorted(str(r["week_start"]) for r in db.tables["cycling_weeks"])
    assert weeks[0] == "2024-12-30" and weeks[-1] == "2026-03-09"  # every week, 0s included
    assert len(weeks) == summary.cycling_weeks == 63

    db.tables["activities"] = [a for a in db.tables["activities"] if a["id"] != "i3"]
    before = sorted(map(str, db.tables["cycling_weeks"]))
    later = datetime(2026, 3, 15, 4, 0, tzinfo=UTC)
    compute.run(db, strength_k=0.02, today=FIXED_TODAY, computed_at=later)
    assert {r["activity_id"] for r in db.tables["ride_metrics"]} == {"i1", "i2"}
    assert {r["computed_at"] for r in db.tables["ride_metrics"]} == {later.isoformat()}
    assert len(db.tables["cycling_weeks"]) == len(before)  # rebuilt, never duplicated


def test_compute_fails_loudly_when_rides_have_no_raw(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook_bytes), db=db)
    [ride] = parse_activities([raw_ride("i1", "2026-03-01T10:00:00", kind="Ride")]).cycling
    upsert_activities(db, [replace(ride, raw=None)])  # stored before raw was kept

    with pytest.raises(compute.RideDataError, match="1 of 1 rides have no raw"):
        compute.run(
            db, strength_k=0.02, today=FIXED_TODAY, computed_at=datetime(2026, 3, 15, tzinfo=UTC)
        )
    assert db.tables["daily_load"] and db.tables["ride_metrics"]  # written before failing


def test_compute_counts_rides_not_fields_toward_the_raw_problem_share(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook_bytes), db=db)
    rides = [analysed_ride(f"i{n}", f"2026-03-0{n}T10:00:00") for n in range(1, 5)]
    # One ride of five with two unreadable fields: 1 ride (20 %), not 2 problems (40 %).
    rides.append(analysed_ride("i5", "2026-03-05T10:00:00", distance="40", device_watts="yes"))
    upsert_activities(db, parse_activities(rides).cycling)

    summary = compute.run(
        db, strength_k=0.02, today=FIXED_TODAY, computed_at=datetime(2026, 3, 15, tzinfo=UTC)
    )
    assert summary.rides_analysed == 5
    bad = next(r for r in db.tables["ride_metrics"] if r["activity_id"] == "i5")
    assert (bad["distance_m"], bad["device_watts"], bad["eftp_ok"]) == (None, None, False)


def test_compute_writes_strength_weeks_phase_and_kg_history_idempotently(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook_bytes), db=db)
    lifts = [raw_ride("g1", "2026-02-03T19:00:00", kind="WeightTraining")]  # week 1, session 1
    upsert_strength_activities(db, parse_activities(lifts).strength)
    run_at = datetime(2026, 3, 15, 3, 0, tzinfo=UTC)

    summary = compute.run(db, strength_k=0.02, today=FIXED_TODAY, computed_at=run_at)

    phases = {b["name"]: b["phase"] for b in db.tables["blocks"]}
    assert phases == {BLOK_11: "in_season", BLOK_12: "off_season"}
    weeks = db.tables["strength_weeks"]
    assert len(weeks) == summary.strength_weeks and len(weeks) % 3 == 0
    squat = {(w["week_start"], w["lift"]): w for w in weeks}[("2026-02-02", "SQUAT")]
    assert squat["status"] == "lifted" and squat["sets_lifted"] == 3  # session 1 matched
    assert squat["tonnage_kg"] == 3 * 5 * 120.0 and squat["e1rm_rpe_source"] == "prescribed"
    kg = db.tables["strength_set_kg"]
    assert len(kg) == summary.kg_states_changed == len(db.tables["strength_sets"])
    lifted = [r for r in kg if r["name"] == "Squat" and r["week_start"] == "2026-02-02"]
    assert {r["lifted_kg"] for r in lifted} == {120.0}
    assert {r["planned_first_kg"] for r in lifted} == {None}  # first seen after it was done

    before = sorted(map(str, kg))
    again = compute.run(
        db, strength_k=0.02, today=FIXED_TODAY, computed_at=datetime(2026, 3, 15, 15, tzinfo=UTC)
    )
    assert again.kg_states_changed == 0 and sorted(map(str, db.tables["strength_set_kg"])) == before
