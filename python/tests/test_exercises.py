"""The exercise catalogue: name matching, the two scoring inputs, unknown names (2026-10-12)."""

import logging

import pytest

from conftest import (
    SYNTHETIC_SHEET_ID,
    InMemoryPostgrest,
    build_workbook,
    legacy_catalog_rows,
    legacy_scoring,
    slice_workbook,
)
from training_load.cli import collect_strength
from training_load.config import GoogleSettings
from training_load.db.exercises import add_unknown, all_exercises, from_row
from training_load.domain.exercises import UNKNOWN_FACTOR, Catalog, Exercise, Scoring
from training_load.sources.strength_sheet import parse_all

BODYWEIGHT = 80.0
GOOGLE = GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={})


def exercise(
    id: int, name: str, *aliases: str, factor: float = 0.6, fraction: float | None = None
) -> Exercise:
    return Exercise(
        id=id,
        name=name,
        aliases=aliases,
        category="accessory",
        parent_lift=None,
        muscle_factor=factor,
        bodyweight_fraction=fraction,
        tracks_e1rm=False,
    )


def run_on(xlsx: bytes, db: InMemoryPostgrest, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(collect_strength, "access_token", lambda _info: "token")
    monkeypatch.setattr(collect_strength, "download_workbook", lambda *_a, **_k: xlsx)
    send = lambda *_a, **_k: None  # noqa: E731  # never called: download_workbook is replaced
    return collect_strength.run(GOOGLE, bodyweight=BODYWEIGHT, send=send, db=db)  # type: ignore[arg-type]


def test_names_match_trimmed_and_case_insensitive_on_name_or_alias() -> None:
    catalog = Catalog([exercise(1, "Pullups", "Pull-ups", "Pull-up"), exercise(2, "Squat")])
    assert catalog.find("  pull-UPS ") == catalog.find("Pullups") == catalog.find("pull-up")
    assert catalog.find("SQUAT") is not None
    assert catalog.find("Chin-ups") is None


def test_a_canonical_name_wins_over_an_alias_and_the_clash_is_listed() -> None:
    catalog = Catalog([exercise(1, "Bænk", "Bænkpres"), exercise(2, "Bænkpres", factor=1.0)])
    found = catalog.find("bænkpres")
    assert found is not None and found.id == 2
    assert catalog.conflicts == ["alias 'Bænkpres' of 'Bænk' already names 'Bænkpres'"]


def test_effective_kg_adds_bodyweight_times_the_fraction_and_null_adds_nothing() -> None:
    catalog = Catalog([exercise(1, "Glute ham raise", fraction=0.6), exercise(2, "Facepulls")])
    ghr = catalog.scoring("Glute ham raise", 85.0)
    assert ghr.muscle_factor == 0.6
    assert ghr.bodyweight_kg is not None and abs(ghr.bodyweight_kg - 51.0) < 1e-9
    assert catalog.scoring("Facepulls", 85.0) == Scoring(0.6, None)


def test_an_unknown_name_scores_as_an_accessory_without_bodyweight() -> None:
    catalog = Catalog([exercise(1, "Squat", factor=1.0)])
    assert catalog.scoring("Nordic curl", 85.0) == Scoring(UNKNOWN_FACTOR, None)
    assert catalog.unknown(["Nordic curl", " nordic CURL", "Squat", "Abs"]) == [
        "Abs",
        "Nordic curl",
    ]


def test_a_catalogue_with_the_old_values_scores_the_real_slice_exactly_as_before() -> None:
    """Acceptance A3: moving the factor and bodyweight into the table changes no score by
    itself; only the values in the table do."""
    catalog = Catalog(from_row(row) for row in legacy_catalog_rows())
    for workbook in (slice_workbook(), build_workbook()):
        old = parse_all(workbook, legacy_scoring(BODYWEIGHT))
        new = parse_all(workbook, catalog.scorer(BODYWEIGHT))
        assert [(p["kg"], p["score"], p["bodyweight"]) for p in new] == [
            (p["kg"], p["score"], p["bodyweight"]) for p in old
        ]


def test_a_new_bodyweight_exercise_keeps_a_logged_zero_and_scores_its_share_of_bodyweight() -> None:
    rows = [r for r in legacy_catalog_rows() if r["name"] != "Dips"]
    catalog = Catalog([*(from_row(r) for r in rows), exercise(999, "Dips", fraction=0.5)])
    dips = [
        p for p in parse_all(build_workbook(), catalog.scorer(BODYWEIGHT)) if p["name"] == "Dips"
    ]
    first = dips[0]  # week 1, 10 kg logged
    assert (first["logged_kg"], first["kg"], first["bodyweight"]) == (10.0, 50.0, True)
    assert first["muscle_factor"] == 0.6


def test_collect_strength_adds_unknown_names_with_the_defaults_and_names_them(
    db: InMemoryPostgrest, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    db.tables["exercises"] = [r for r in db.tables["exercises"] if r["name"] != "Leg extension"]
    with caplog.at_level(logging.WARNING):
        run_on(build_workbook(), db, monkeypatch)
    assert "1 exercises not in public.exercises" in caplog.text
    assert "Leg extension" in caplog.text
    added = next(e for e in all_exercises(db) if e.name == "Leg extension")
    assert (added.category, added.muscle_factor, added.bodyweight_fraction) == (
        "accessory",
        UNKNOWN_FACTOR,
        None,
    )
    stored = {
        r["muscle_factor"] for r in db.tables["strength_sets"] if r["name"] == "Leg extension"
    }
    assert stored == {UNKNOWN_FACTOR}  # scored with the defaults in the same run


def test_a_hand_edited_value_is_used_and_never_overwritten(
    db: InMemoryPostgrest, monkeypatch: pytest.MonkeyPatch
) -> None:
    squat = next(r for r in db.tables["exercises"] if r["name"] == "Squat")
    squat["muscle_factor"] = 0.9
    run_on(build_workbook(), db, monkeypatch)
    run_on(build_workbook(), db, monkeypatch)  # a second run inserts nothing, edits nothing
    assert next(r for r in db.tables["exercises"] if r["name"] == "Squat")["muscle_factor"] == 0.9
    assert {r["muscle_factor"] for r in db.tables["strength_sets"] if r["name"] == "Squat"} == {0.9}
    assert len(db.tables["exercises"]) == len(legacy_catalog_rows())


def test_add_unknown_skips_a_name_that_is_already_stored(db: InMemoryPostgrest) -> None:
    before = len(db.tables["exercises"])
    add_unknown(db, ["Squat", "Nordic curl"])
    assert len(db.tables["exercises"]) == before + 1


def test_a_mistyped_row_fails_loudly() -> None:
    row = dict(legacy_catalog_rows()[0])
    row["aliases"] = "Pull-ups"
    with pytest.raises(ValueError, match="aliases"):
        from_row(row)
