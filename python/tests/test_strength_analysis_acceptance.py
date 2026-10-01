"""Task e1 acceptance (tester): the producer's real output against the migration's checks, the
LSRPE column on the real slice, the issue threshold, phase inheritance and the e1RM round trip
through planned_load. Complements test_strength_analysis.py (unit rules) and test_cli.py.
"""

import json
import logging
import re
from collections import Counter
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest

import test_real_slice as real
from conftest import SYNTHETIC_BODYWEIGHT, SYNTHETIC_SHEET_ID, InMemoryPostgrest, raw_ride
from training_load.cli import collect_strength, compute
from training_load.config import GoogleSettings
from training_load.db.client import JsonRow
from training_load.db.strength_activities import upsert_strength_activities
from training_load.db.strength_sets import replace_for_sheet
from training_load.domain import planned_load
from training_load.domain.strength import Block, StrengthSet, iso_week_start
from training_load.domain.strength_analysis import set_key, strength_weeks
from training_load.sources.intervals import parse_activities
from training_load.sources.strength_sheet import (
    LSRPE_COLUMN_MISSING,
    LSRPE_NOT_HALF,
    ParsedSet,
    parse_all,
)

MakeSet = Callable[..., StrengthSet]
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20261001140000_strength_analysis.sql"
CONTRACT = ROOT / "web" / "tests" / "fixtures" / "strength_weeks.json"
GOOGLE = GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={})
TODAY = date(2026, 3, 15)
RUN_AT = datetime(2026, 3, 15, 3, 0, tzinfo=UTC)
LSRPE_W1 = 8  # 0-based column of week 1's LSRPE in the slice (SETS at 4)


# --- the migration's check constraints as predicates (one per SQL check) ----------------------


def _half(x: float) -> bool:
    return x * 2 == round(x * 2)


def week_row_violations(r: JsonRow) -> list[str]:
    e = r["e1rm_kg"]
    nulls = {k: r[k] is None for k in ("e1rm_load_kg", "e1rm_reps", "e1rm_rpe", "e1rm_rpe_source")}
    checks = {
        "isodow": date.fromisoformat(str(r["week_start"])).isoweekday() == 1,
        "lift": r["lift"] in ("SQUAT", "BENCH", "DEADLIFT"),
        "phase": r["phase"] in (None, "in_season", "off_season"),
        "status": r["status"] in (None, "lifted", "pre_log"),
        "sets_lifted": isinstance(r["sets_lifted"], int) and r["sets_lifted"] >= 0,
        "tonnage": r["tonnage_kg"] is not None and cast(float, r["tonnage_kg"]) >= 0,
        "e1rm_bounds": e is None or 20 <= cast(float, e) <= 400,
        "source": r["e1rm_rpe_source"] in (None, "logged", "prescribed"),
        "best_bool": isinstance(r["is_block_best"], bool),
        "computed_at": r["computed_at"] is not None,
        "e1rm~source": (e is None) == nulls["e1rm_rpe_source"],
        "e1rm~parts": all(
            (e is None) == nulls[k] for k in ("e1rm_load_kg", "e1rm_reps", "e1rm_rpe")
        ),
        "best~e1rm": e is not None or not r["is_block_best"],
        "sets~status": (r["sets_lifted"] == 0) == (r["status"] is None),
        "block~no": (r["block"] is None) == (r["block_no"] is None),
    }
    return [name for name, ok in checks.items() if not ok]


def kg_row_violations(r: JsonRow) -> list[str]:
    checks = {
        "sheet_row": cast(int, r["sheet_row"]) > 0,
        "week": cast(int, r["week"]) > 0,
        "set_no": cast(int, r["set_no"]) > 0,
        "session": cast(int, r["session"]) > 0,
        "occurrence": cast(int, r["occurrence"]) > 0,
        "not_null": all(r[k] is not None for k in ("type", "name", "week_start", "first_seen_at")),
        "first~at": (r["planned_first_kg"] is None) == (r["planned_first_at"] is None),
        "last~at": (r["planned_last_kg"] is None) == (r["planned_last_at"] is None),
        "first~last": (r["planned_first_kg"] is None) == (r["planned_last_kg"] is None),
        "lifted~at": r["lifted_kg"] is None or r["lifted_first_at"] is not None,
    }
    return [name for name, ok in checks.items() if not ok]


def run_pipeline(
    xlsx: bytes, weight_training: list[str], monkeypatch: pytest.MonkeyPatch
) -> InMemoryPostgrest:
    db = InMemoryPostgrest()
    monkeypatch.setattr(collect_strength, "access_token", lambda _info: "token")
    monkeypatch.setattr(collect_strength, "download_workbook", lambda *_a, **_k: xlsx)
    send = lambda *_a, **_k: None  # noqa: E731  # never called: download_workbook is replaced
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=send, db=db)  # type: ignore[arg-type]
    acts = [
        raw_ride(f"g{i}", start, kind="WeightTraining") for i, start in enumerate(weight_training)
    ]
    upsert_strength_activities(db, parse_activities(acts).strength)
    compute.run(db, strength_k=0.02, today=TODAY, computed_at=RUN_AT)
    return db


def assert_rows_fit_the_migration(db: InMemoryPostgrest) -> None:
    for r in db.tables["strength_weeks"]:
        assert week_row_violations(r) == [], r
    for r in db.tables["strength_set_kg"]:
        assert kg_row_violations(r) == [], r
    assert {b["phase"] for b in db.tables["blocks"]} <= {"in_season", "off_season"}
    for s in db.tables["strength_sets"]:
        rpe = s["logged_rpe"]
        assert rpe is None or (1 <= cast(float, rpe) <= 10 and _half(cast(float, rpe))), s


def assert_weeks_are_complete(db: InMemoryPostgrest) -> None:
    rows = db.tables["strength_weeks"]
    first = min(date.fromisoformat(str(s["week_start"])) for s in db.tables["strength_sets"])
    n_weeks = (iso_week_start(TODAY) - first).days // 7 + 1
    assert len(rows) == n_weeks * 3
    keys = {(str(r["week_start"]), str(r["lift"])) for r in rows}
    expected = {
        ((first + timedelta(weeks=i)).isoformat(), lift)
        for i in range(n_weeks)
        for lift in ("SQUAT", "BENCH", "DEADLIFT")
    }
    assert keys == expected  # no gaps, no duplicates
    for r in rows:
        if r["sets_lifted"] == 0:
            assert (r["tonnage_kg"], r["status"]) == (0, None)
    best = Counter((r["block"], r["lift"]) for r in rows if r["is_block_best"])
    with_e1rm = {(r["block"], r["lift"]) for r in rows if r["e1rm_kg"] is not None and r["block"]}
    assert set(best) == with_e1rm and set(best.values()) <= {1}


def test_compute_on_the_synthetic_workbook_writes_rows_every_migration_check_accepts(
    workbook_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    lifts = [
        "2026-02-03T19:00:00",  # blok 11 week 1 session 1; session 2 (Tempo bench) is pre_log
        "2026-02-10T19:00:00",
        "2026-03-10T19:00:00",  # blok 12 week 1: lifted
    ]
    db = run_pipeline(workbook_bytes, lifts, monkeypatch)
    assert any(r["e1rm_kg"] is not None for r in db.tables["strength_weeks"])
    assert any(r["status"] == "pre_log" for r in db.tables["strength_weeks"])
    assert_rows_fit_the_migration(db)
    assert_weeks_are_complete(db)


def test_compute_on_the_real_slice_writes_rows_every_migration_check_accepts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lsrpe = {(25, LSRPE_W1): "7,5", (28, LSRPE_W1): 8, (26, LSRPE_W1): "7.8"}
    db = run_pipeline(real.workbook(lsrpe), ["2025-09-30T18:00:00"], monkeypatch)
    assert {r["logged_rpe"] for r in db.tables["strength_sets"]} == {None, 7.5, 8.0}
    assert_rows_fit_the_migration(db)
    assert_weeks_are_complete(db)
    week1 = {r["lift"]: r for r in db.tables["strength_weeks"] if r["week_start"] == "2025-09-29"}
    assert week1["SQUAT"]["e1rm_rpe_source"] == "logged"
    # Tonnage over the slice's lifted sets: squat 1x3x110 + 1x3x112.5 + 2x5x100 (text and formula
    # kg), bench 1x3x65 + 1x3x65 + 2x8x60. The sheet's TONNAGE cells are block totals over rows
    # outside the slice (no deadlift row is in it), so they can't be compared here.
    assert (week1["SQUAT"]["tonnage_kg"], week1["BENCH"]["tonnage_kg"]) == (1667.5, 1350.0)
    assert week1["DEADLIFT"]["tonnage_kg"] == 0


def test_the_contract_fixture_fits_the_migration() -> None:
    rows = cast(list[JsonRow], json.loads(CONTRACT.read_text("utf-8")))
    assert rows
    for r in rows:
        assert week_row_violations(r) == [], r


def test_the_migration_locks_both_new_tables_to_the_service_role() -> None:
    sql = MIGRATION.read_text("utf-8")
    assert "create policy" not in sql.lower()
    for table in ("strength_weeks", "strength_set_kg"):
        assert f"alter table public.{table} enable row level security;" in sql
        assert f"revoke all on table public.{table} from anon, authenticated;" in sql
        assert re.search(
            rf"grant select, insert, update, delete on table public\.{table} to service_role;", sql
        )


# --- parser on the real slice ------------------------------------------------------------------


def week1(parsed: list[ParsedSet], row: int) -> ParsedSet:
    return real.sets_of(parsed, row, 1)[0]


def test_lsrpe_on_the_real_slice_reads_comma_text_and_counts_junk_once_per_cell() -> None:
    issues: Counter[str] = Counter()
    edits = {(25, LSRPE_W1): "7,5", (26, LSRPE_W1): "7.8", (28, LSRPE_W1): 8, (29, LSRPE_W1): "x"}
    parsed = parse_all(real.workbook(edits | {(30, LSRPE_W1): " "}), real.BODYWEIGHT, issues)
    assert issues == Counter({LSRPE_NOT_HALF: 2})  # per cell, not per set (row 30 has 2 sets)
    assert [week1(parsed, r)["logged_rpe"] for r in (25, 26, 28, 29, 30)] == [
        7.5,
        None,
        8.0,
        None,
        None,
    ]
    raw = week1(parsed, 25)["raw"]
    assert list(raw) == ["sets", "reps", "load", "weight", "lsrpe", "notes", "mean_weight"]
    assert (raw["load"], raw["weight"], raw["lsrpe"], raw["notes"]) == ("RPE 5", "110", "7,5", None)
    assert raw["mean_weight"] == 110
    assert week1(parsed, 27)["raw"]["load"] == -0.1  # the formula back-off stays a number


def test_a_tab_without_lsrpe_in_its_column_counts_it_and_ignores_the_cells() -> None:
    issues: Counter[str] = Counter()
    parsed = parse_all(
        real.workbook({(24, LSRPE_W1): "RPE", (25, LSRPE_W1): "7"}), real.BODYWEIGHT, issues
    )
    assert issues == Counter({LSRPE_COLUMN_MISSING: 1})
    assert {p["logged_rpe"] for p in parsed} == {None}
    assert week1(parsed, 25)["raw"]["lsrpe"] == "7"  # still kept as written


@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_lsrpe_junk_hits_the_issue_threshold_exactly_like_kg_junk(n: int) -> None:
    rows = range(25, 25 + n)

    def fails(edits: dict[tuple[int, int], object]) -> bool:
        issues: Counter[str] = Counter()
        parsed = parse_all(real.workbook(edits), real.BODYWEIGHT, issues)
        try:
            collect_strength.check_issues(issues, parsed)
        except collect_strength.TooManyIssuesError:
            return True
        return False

    lsrpe = fails({(r, LSRPE_W1): "x" for r in rows})
    kg = fails({(r, 7): "x" for r in rows})
    assert lsrpe == kg


# --- phase inheritance -------------------------------------------------------------------------


def test_compute_marks_phases_and_warns_about_an_unconfirmed_blok_13(
    make_set: MakeSet, caplog: pytest.LogCaptureFixture
) -> None:
    db = InMemoryPostgrest()
    sets = [
        make_set(block="Program - blok 11", week_start=date(2026, 1, 5)),
        make_set(block="Program - blok 12 (offseason)", week_start=date(2026, 2, 2)),
        make_set(block="Program - blok 13", week_start=date(2026, 3, 2)),
    ]
    replace_for_sheet(db, SYNTHETIC_SHEET_ID, sets)
    with caplog.at_level(logging.WARNING):
        compute.run(db, strength_k=0.02, today=TODAY, computed_at=RUN_AT)
    phases = {b["block_no"]: b["phase"] for b in db.tables["blocks"]}
    assert phases == {11: "in_season", 12: "off_season", 13: "off_season"}
    assert "blok 13: phase off_season is inherited" in caplog.text
    assert "blok 12:" not in caplog.text


# --- e1RM round trip through the plan rule -----------------------------------------------------


@pytest.mark.parametrize(
    ("lift", "name", "reps", "prescribed", "one_rm"),
    [
        ("SQUAT", "Squat", 3.0, "RPE 6", 145.0),
        ("BENCH", "Bænk", 8.0, "RPE 5 - 6", 82.5),
        ("DEADLIFT", "Dødløft", 5.0, "RPE 7,5", 145.0),
    ],
)
def test_a_set_lifted_at_the_plans_kg_gives_back_the_tabs_1rm(
    make_set: MakeSet, lift: str, name: str, reps: float, prescribed: str, one_rm: float
) -> None:
    plan = make_set(
        type=lift, name=name, reps=reps, prescribed=prescribed, e1rm=one_rm, logged_kg=None
    )
    planned = planned_load._main_lift_kg(plan)
    assert planned is not None and planned[1] == "rpe_e1rm"
    lifted = make_set(type=lift, name=name, reps=reps, prescribed=prescribed, logged_kg=planned[0])
    block = Block("s", "Program - blok 12", 12, lifted.week_start, lifted.week_start, None)
    weeks = strength_weeks(
        [lifted], {set_key(lifted): "lifted"}, [block], today=lifted.week_start
    ).weeks
    best = next(w for w in weeks if w.lift == lift)
    assert best.e1rm_kg == pytest.approx(one_rm, abs=0.1)
    assert best.e1rm_rpe_source == "prescribed" and best.is_block_best
