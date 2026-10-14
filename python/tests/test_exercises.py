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
from training_load.sources.strength_sheet import parse_all, set_score

BODYWEIGHT = 80.0
GOOGLE = GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={})


def exercise(
    id: int,
    name: str,
    *aliases: str,
    factor: float = 0.6,
    fraction: float | None = None,
    per_side: bool = False,
    per_dumbbell: bool = False,
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
        per_side=per_side,
        kg_per_dumbbell=per_dumbbell,
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


def test_dips_with_10_kg_extra_lift_86_5_kg_effective() -> None:
    """User, 2026-10-14: dips at fraction 0.90 and BODYWEIGHT 85 (a test value; the real one is
    the BODYWEIGHT env var) with +10 kg logged score 10 + 85 x 0.9 = 86.5 kg."""
    catalog = Catalog([exercise(23, "Dips", "Dip", fraction=0.9)])
    scoring = catalog.scoring("dip", 85.0)
    result: object = set_score(  # type: ignore[no-untyped-call]  # untyped legacy module
        "UPPER", "Dips", 8, 10.0, "RPE 8", scoring.bodyweight_kg, scoring.muscle_factor, None
    )
    assert isinstance(result, tuple)
    kg_used, _rpe, _score, bodyweight = result
    assert bodyweight is True and abs(float(kg_used) - 86.5) < 1e-9


def test_per_side_and_per_dumbbell_reach_the_scoring() -> None:
    catalog = Catalog(
        [exercise(1, "RFE split squat", fraction=0.75, per_side=True, per_dumbbell=True)]
    )
    assert catalog.scoring("rfe split squat", 85.0) == Scoring(0.6, 63.75, sides=2, kg_factor=2)
    assert Catalog([exercise(2, "Squat")]).scoring("Squat", 85.0) == Scoring(0.6, None)


def test_rfe_split_squat_counts_both_legs_and_both_dumbbells() -> None:
    """User, 2026-10-14 (reading C): reps are per leg, kg per dumbbell. 25 kg x 8 reps at fraction
    0.75 and BODYWEIGHT 85 (test values) is 2 x 25 + 63.75 = 113.75 kg effective, scored for 16
    reps: exactly twice the one-leg score at that kg. The formula is unchanged; its inputs are."""
    rfe = Catalog([exercise(1, "RFE split squat", fraction=0.75, per_side=True, per_dumbbell=True)])
    s = rfe.scoring("RFE split squat", 85.0)
    both: object = set_score(  # type: ignore[no-untyped-call]  # untyped legacy module
        "QUADS",
        "RFE split squat",
        8 * s.sides,
        25.0 * s.kg_factor,
        "RPE 7",
        s.bodyweight_kg,
        0.6,
        None,
    )
    one: object = set_score(  # type: ignore[no-untyped-call]  # untyped legacy module
        "QUADS", "RFE split squat", 8, 113.75 - 63.75, "RPE 7", 63.75, 0.6, None
    )
    assert isinstance(both, tuple) and isinstance(one, tuple)
    assert abs(float(both[0]) - 113.75) < 1e-9
    assert abs(float(both[2]) - 2 * float(one[2])) < 1e-9


def test_the_parser_doubles_reps_per_side_and_kg_per_dumbbell() -> None:
    plain = [
        p
        for p in parse_all(
            build_workbook(),
            Catalog([*(from_row(r) for r in legacy_catalog_rows())]).scorer(BODYWEIGHT),
        )
        if p["name"] == "Dips"
    ]
    rows = [r for r in legacy_catalog_rows() if r["name"] != "Dips"]
    marked = Catalog(
        [
            *(from_row(r) for r in rows),
            exercise(999, "Dips", fraction=0.5, per_side=True, per_dumbbell=True),
        ]
    )
    dips = [
        p for p in parse_all(build_workbook(), marked.scorer(BODYWEIGHT)) if p["name"] == "Dips"
    ]
    first = dips[0]  # week 1, 10 kg logged
    assert (first["logged_kg"], first["kg"], first["sides"], first["kg_factor"]) == (
        10.0,
        60.0,
        2,
        2,
    )
    assert first["reps"] == plain[0]["reps"]  # stored as written: per side
    rpe = first["rpe"]
    assert rpe is not None
    expected = 2 * first["reps"] * 60.0 * (rpe / 10) ** 2 * first["muscle_factor"]
    assert abs(first["score"] - round(expected, 1)) < 1e-9


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
