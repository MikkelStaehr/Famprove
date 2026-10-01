"""domain.planned_load: planned kg per set and the plan score of a session (acceptance 2-5)."""

from collections.abc import Callable
from datetime import date

import pytest

from training_load.domain.planned_load import planned_session_score
from training_load.domain.strength import StrengthSet

MakeSet = Callable[..., StrengthSet]
BLOK_12 = "Program - blok 12"
W41 = date(2026, 10, 5)


def plan(make_set: MakeSet, **overrides: object) -> StrengthSet:
    base: dict[str, object] = {
        "block": BLOK_12,
        "week": 2,
        "week_start": W41,
        "session": 1,
        "logged_kg": None,
        "kg": 0.0,
        "score": 0.0,
        "rpe": 6.0,
    }
    return make_set(**(base | overrides))


def test_main_lift_kg_from_e1rm_and_prescribed_rpe(make_set: MakeSet) -> None:
    squat = plan(make_set, type="SQUAT", name="Squat", reps=5.0, prescribed="RPE 8", e1rm=150.0)
    result = planned_session_score([squat], [])
    # kg = 150 / (1 + 0.0333 * (5 + 10 - 8)) = 121.6; score = 5 * 121.6 * 0.8^2 * 1.0
    assert result.score == pytest.approx(389.3, abs=0.1)
    assert result.sources == {"rpe_e1rm": 1}


def test_entered_kg_uses_the_stored_score(make_set: MakeSet) -> None:
    entered = plan(make_set, type="SQUAT", name="Squat", logged_kg=137.5, kg=137.5, score=123.4)
    assert planned_session_score([entered], []).score == pytest.approx(123.4)


def test_backoff_is_90_percent_of_the_top_set(make_set: MakeSet) -> None:
    top = plan(
        make_set, type="SQUAT", name="Squat", reps=3.0, prescribed="RPE 8", e1rm=150.0, sheet_row=10
    )
    backoff = plan(
        make_set, type="SQUAT", name="Squat", reps=5.0, prescribed="-10%", e1rm=150.0, sheet_row=11
    )
    result = planned_session_score([top, backoff], [])
    assert result.sources == {"rpe_e1rm": 1, "backoff": 1}
    assert result.unscored == 0


def test_accessory_kg_from_the_same_row_then_the_same_name(make_set: MakeSet) -> None:
    earlier_row = plan(
        make_set,
        type="BACK",
        name="Lat pulldowns",
        week=1,
        week_start=date(2026, 9, 28),
        logged_kg=48.0,
        sheet_row=33,
    )
    earlier_block = plan(
        make_set,
        type="BACK",
        name="Cable row",
        block="Program - blok 11",
        week=5,
        week_start=date(2026, 9, 7),
        logged_kg=40.0,
        sheet_row=50,
    )
    pulldown = plan(
        make_set, type="BACK", name="Lat pulldowns", reps=8.0, prescribed="RPE 7", sheet_row=33
    )
    row = plan(make_set, type="BACK", name="Cable row", reps=10.0, prescribed="RPE 7", sheet_row=60)
    result = planned_session_score([pulldown, row], [earlier_row, earlier_block])
    assert result.sources == {"same_row": 1, "same_name": 1}
    # 8 * 48 * 0.7^2 * 0.6 + 10 * 40 * 0.7^2 * 0.6
    assert result.score == pytest.approx(8 * 48 * 0.49 * 0.6 + 10 * 40 * 0.49 * 0.6)


def test_a_set_without_any_kg_rule_is_unscored_not_zero(make_set: MakeSet) -> None:
    unknown = plan(make_set, type="BACK", name="New exercise", prescribed="RPE 7")
    result = planned_session_score([unknown], [])
    assert (result.score, result.unscored, result.sources) == (0.0, 1, {})


def test_a_deload_week_scores_lower(make_set: MakeSet) -> None:
    normal = [
        plan(
            make_set, type="SQUAT", name="Squat", reps=5.0, prescribed="RPE 8", e1rm=150.0, set_no=n
        )
        for n in (1, 2, 3)
    ]
    deload = [
        plan(
            make_set,
            type="SQUAT",
            name="Squat",
            reps=5.0,
            prescribed="RPE 6",
            e1rm=150.0,
            set_no=n,
            week=4,
        )
        for n in (1, 2)
    ]
    assert planned_session_score(deload, []).score < planned_session_score(normal, []).score
