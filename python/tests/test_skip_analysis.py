"""skip-analysis (user, 2026-10-16): a set skipped in the app affects nothing - not tonnage, the
e1RM, the rolling e1RM, last week's anchor, Fokus's "samme som sidst" or the kg history's lifted
kg - as it already adds no TSS (skip-tss)."""

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import cast

import pytest

from conftest import InMemoryPostgrest
from test_strength_analysis_acceptance import RUN_AT, TODAY, run_pipeline
from training_load.cli import compute
from training_load.domain.kg_history import kg_keys, next_kg_state
from training_load.domain.planned_sets import last_week_kg, rolling_e1rm
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import (
    StrengthWeek,
    counts,
    kg_statuses,
    set_key,
    strength_weeks,
)
from training_load.domain.today_kg import TodayKg, ref, today_kgs

MakeSet = Callable[..., StrengthSet]
LAST = date(2026, 10, 5)  # last week
THIS = date(2026, 10, 12)  # the run week
DAY = date(2026, 10, 16)  # today
SKIP_2 = {(LAST, 1, 10, 2)}  # (ISO week, session, sheet row, set) of the skipped set


def _squat(make_set: MakeSet, set_no: int, kg: float | None, week: date = LAST) -> StrengthSet:
    return make_set(
        week_start=week, set_no=set_no, reps=3.0, logged_kg=kg, kg=kg, prescribed="RPE 8"
    )


def _week(weeks: list[StrengthWeek], week: date = LAST) -> StrengthWeek:
    return next(w for w in weeks if w.week_start == week and w.lift == "SQUAT")


def test_skipped_is_its_own_status_and_never_counts(make_set: MakeSet) -> None:
    a, b = _squat(make_set, 1, 140.0), _squat(make_set, 2, 150.0)
    statuses = kg_statuses([a, b], {(LAST, 1)}, DAY, SKIP_2)
    assert (statuses[set_key(a)], statuses[set_key(b)]) == ("lifted", "skipped")
    # A skip wins even before the session is matched to an activity.
    assert kg_statuses([b], set(), DAY, SKIP_2)[set_key(b)] == "skipped"
    assert [counts(s) for s in ("lifted", "pre_log", "planned", "skipped")] == [
        True,
        True,
        False,
        False,
    ]


def test_a_skipped_set_is_out_of_tonnage_sets_lifted_and_the_e1rm(make_set: MakeSet) -> None:
    sets = [_squat(make_set, 1, 140.0), _squat(make_set, 2, 150.0)]
    done = {(LAST, 1)}
    plain = _week(strength_weeks(sets, kg_statuses(sets, done, DAY), [], today=DAY).weeks)
    skip = _week(strength_weeks(sets, kg_statuses(sets, done, DAY, SKIP_2), [], today=DAY).weeks)
    assert (plain.tonnage_kg, plain.sets_lifted, plain.e1rm_load_kg) == (870.0, 2, 150.0)
    assert (skip.tonnage_kg, skip.sets_lifted, skip.e1rm_load_kg) == (420.0, 1, 140.0)


def test_a_skipped_set_is_out_of_the_rolling_e1rm_and_last_weeks_anchor(
    make_set: MakeSet,
) -> None:
    a, b = _squat(make_set, 1, 140.0), _squat(make_set, 2, 150.0)
    done = {(LAST, 1)}
    plain = kg_statuses([a, b], done, DAY)
    skip = kg_statuses([a, b], done, DAY, SKIP_2)
    assert rolling_e1rm([a, b], plain, "SQUAT", THIS) == pytest.approx(150.0 * (1 + 0.0333 * 5))
    assert rolling_e1rm([a, b], skip, "SQUAT", THIS) == pytest.approx(140.0 * (1 + 0.0333 * 5))
    # "Sidste uge" anchors on the first set with logged kg: set 1 skipped -> set 2.
    first_skipped = kg_statuses([a, b], done, DAY, {(LAST, 1, 10, 1)})
    assert last_week_kg([a, b], plain)[(a.block, 10, LAST)].set_no == 1
    assert last_week_kg([a, b], first_skipped)[(a.block, 10, LAST)].set_no == 2
    every = kg_statuses([a, b], done, DAY, {(LAST, 1, 10, 1), (LAST, 1, 10, 2)})
    assert last_week_kg([a, b], every) == {}


def test_samme_som_sidst_never_comes_from_a_skipped_set(make_set: MakeSet) -> None:
    last = _squat(make_set, 1, 130.0)
    now = make_set(week_start=THIS, set_no=1, reps=3.0, logged_kg=None, kg=None, prescribed=None)
    done = {(LAST, 1)}
    plain = today_kgs([last, now], {}, run_week=THIS, statuses=kg_statuses([last], done, DAY))
    assert plain[ref(now)] == TodayKg(130.0, "last")
    skipped = kg_statuses([last], done, DAY, {(LAST, 1, 10, 1)})
    assert ref(now) not in today_kgs([last, now], {}, run_week=THIS, statuses=skipped)


def test_the_kg_history_withdraws_a_lifted_kg_once_the_set_is_skipped(make_set: MakeSet) -> None:
    s = _squat(make_set, 2, 150.0)
    key = kg_keys([s])[set_key(s)]
    t0, t1 = datetime(2026, 10, 6, 6, tzinfo=UTC), datetime(2026, 10, 6, 12, tzinfo=UTC)
    planned = next_kg_state(None, s, key, "planned", t0)
    lifted = next_kg_state(planned, s, key, "lifted", t0)
    assert lifted.lifted_kg == 150.0
    gone = next_kg_state(lifted, s, key, "skipped", t1)
    assert (gone.lifted_kg, gone.lifted_changed_at) == (None, t1)
    assert gone.planned_last_kg == planned.planned_last_kg  # the plan as last seen
    # Skipped from the start: nothing lifted is ever recorded, and the plan stays as seen.
    assert next_kg_state(planned, s, key, "skipped", t1) == planned


def test_compute_leaves_a_set_skipped_in_the_app_out_of_the_analysis(
    workbook_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Wiring (CLAUDE.md "new DB input"): compute reads exercise_set_log.skipped into the kg
    statuses, so strength_weeks and strength_set_kg drop the set on the next run."""
    db: InMemoryPostgrest = run_pipeline(workbook_bytes, ["2026-03-10T19:00:00"], monkeypatch)
    week = "2026-03-09"
    before = {r["lift"]: r for r in db.tables["strength_weeks"] if r["week_start"] == week}
    squat = next(
        r
        for r in db.tables["strength_sets"]
        if r["week_start"] == week and r["type"] == "SQUAT" and cast(float, r["logged_kg"] or 0) > 0
    )
    sets_before = cast(int, before["SQUAT"]["sets_lifted"])
    assert sets_before > 0
    db.tables.setdefault("exercise_set_log", []).append(
        {
            "date": "2026-03-10",
            "session_no": squat["session"],
            "row_no": squat["sheet_row"],
            "set_no": squat["set_no"],
            "exercise_id": 1,
            "kind": "set",
            "started_at": None,
            "ended_at": None,
            "skipped": True,
            "felt_rpe": None,
            "reps_done": None,
            "timing_ok": True,
            "updated_at": "2026-03-10T19:30:00+00:00",
        }
    )
    compute.run(db, strength_k=0.02, today=TODAY, computed_at=RUN_AT)
    after = {r["lift"]: r for r in db.tables["strength_weeks"] if r["week_start"] == week}
    lifted = cast(float, squat["logged_kg"]) * cast(float, squat["reps"])
    assert after["SQUAT"]["sets_lifted"] == sets_before - 1
    tonnage_before = cast(float, before["SQUAT"]["tonnage_kg"])
    assert after["SQUAT"]["tonnage_kg"] == pytest.approx(tonnage_before - lifted)
    kg_row = next(
        r
        for r in db.tables["strength_set_kg"]
        if r["week_start"] == week
        and r["sheet_row"] == squat["sheet_row"]
        and r["set_no"] == squat["set_no"]
        and r["session"] == squat["session"]
    )
    assert kg_row["lifted_kg"] is None
    final = next(
        r
        for r in db.tables["strength_sets"]
        if (r["week_start"], r["sheet_row"], r["set_no"])
        == (week, squat["sheet_row"], squat["set_no"])
    )
    assert final["score_final"] == 0  # and no TSS, as since skip-tss
