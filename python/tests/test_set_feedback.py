"""Felt RPE and reps done from the Fokus pause screen (domain.set_feedback, 2026-10-13)."""

from collections.abc import Callable
from dataclasses import replace
from datetime import date, timedelta

import pytest

from training_load.domain.set_feedback import (
    LoggedSet,
    Progression,
    exercise_feel,
    progressions,
    range_top,
    rolling_e1rm_at,
    with_reps_done,
    with_rolling_e1rm_rpe,
)
from training_load.domain.strength import StrengthSet
from training_load.domain.strength_analysis import StrengthWeek

MakeSet = Callable[..., StrengthSet]
MONDAY = date(2026, 10, 12)


def entry(
    row: int,
    set_no: int = 1,
    *,
    day: date = MONDAY,
    session: int = 1,
    exercise_id: int = 8,
    felt: int | None = None,
    reps: float | None = None,
    minute: int = 0,
    skipped: bool = False,
) -> LoggedSet:
    ended = None if skipped else f"{day.isoformat()}T08:{minute:02d}:00+00:00"
    return LoggedSet(day, session, row, set_no, exercise_id, ended, skipped, felt, reps)


@pytest.mark.parametrize(
    ("text", "top"),
    [("8 - 12", 12.0), ("20 - 30", 30.0), ("6-10", 10.0), ("3", None), (None, None)],
)
def test_the_top_of_a_range(text: str | None, top: float | None) -> None:
    assert range_top(text) == top


def test_reps_done_replace_the_range_midpoint_and_the_set_is_scored_again(
    make_set: MakeSet,
) -> None:
    accessory = make_set(
        week_start=MONDAY, session=1, sheet_row=32, set_no=1, type="CHEST/SHOULDERS",
        name="Low incline DB press", reps=8.0, reps_text="6 - 10", prescribed="RPE 7 - 8",
        logged_kg=30.0, kg=30.0, muscle_factor=0.6, score=8 * 30 * 0.75**2 * 0.6,
    )  # fmt: skip
    fixed = make_set(week_start=MONDAY, session=1, sheet_row=25, set_no=1, reps=3.0, reps_text="3")
    sets, applied = with_reps_done(
        [accessory, fixed], [entry(32, reps=10.0), entry(25, reps=5.0), entry(32, 2, reps=9.0)]
    )
    assert applied == 1  # a fixed-rep set never takes reps done
    assert sets[0].reps == 10.0
    assert sets[0].score == pytest.approx(round(10 * 30 * 0.75**2 * 0.6, 1))  # the formula, 10 reps
    assert sets[1] == fixed


def test_an_unreadable_rpe_cell_is_not_used_when_scored_again(make_set: MakeSet) -> None:
    # The parser scores "RPE 7,8" as RPE unknown (6.0); the rescore must too.
    s = make_set(
        week_start=MONDAY, session=1, sheet_row=32, set_no=1, type="CHEST/SHOULDERS",
        name="Low incline DB press", reps=8.0, reps_text="6 - 10", prescribed="RPE 7,8",
        logged_kg=30.0, kg=30.0, muscle_factor=0.6, score=8 * 30 * 0.6**2 * 0.6,
    )  # fmt: skip
    sets, applied = with_reps_done([s], [entry(32, reps=10.0)])
    assert applied == 1
    assert sets[0].score == pytest.approx(round(10 * 30 * 0.6**2 * 0.6, 1))


def test_two_lighter_in_a_row_step_up_and_two_harder_hold() -> None:
    lighter = [entry(32, 1, felt=-1, minute=1), entry(32, 2, felt=-1, minute=5)]
    assert progressions(lighter, []) == {8: Progression("step", "de sidste to var lettere")}
    harder = [
        entry(32, 1, felt=-1, minute=1),
        entry(32, 2, felt=1, minute=5),
        entry(32, 3, felt=1, minute=9),
    ]
    assert progressions(harder, []) == {8: Progression("hold", "de sidste to var hårdere")}
    mixed = [entry(32, 1, felt=-1, minute=1), entry(32, 2, felt=0, minute=5)]
    assert progressions(mixed, []) == {}
    # A skipped set never counts; the order is by when the set ended.
    late_first = [
        entry(32, 2, felt=-1, minute=9),
        entry(32, 1, felt=1, minute=1),
        entry(32, 3, felt=-1, skipped=True),
    ]
    assert progressions(late_first, []) == {}


def test_every_set_at_the_top_in_two_sessions_steps_up(make_set: MakeSet) -> None:
    week = [
        make_set(week_start=MONDAY, session=s, sheet_row=32, set_no=n, reps_text="6 - 10", reps=8.0)
        for s in (1, 2)
        for n in (1, 2)
    ]
    top = [entry(32, n, session=s, reps=10.0) for s in (1, 2) for n in (1, 2)]
    assert progressions(top, week) == {8: Progression("step", "du ramte 10 reps to gange")}
    one_short = [*top[:3], entry(32, 2, session=2, reps=9.0)]
    assert progressions(one_short, week) == {}
    assert progressions(top[:2], week) == {}  # one session is not two


def test_the_feel_line_needs_four_rated_sets_and_names_the_offset() -> None:
    three = [entry(32, n, felt=-1, minute=n) for n in (1, 2, 3)]
    assert exercise_feel(three, {8: 5.0}) == []
    four = [*three, entry(33, 1, felt=0, minute=4)]
    [feel] = exercise_feel(four, {8: 5.0})
    assert (feel.rated_n, feel.lighter_n, feel.expected_n, feel.harder_n) == (4, 3, 1, 0)
    assert feel.verdict_text == (
        "Du melder oftest lettere end foreskrevet – forslaget ligger 5 kg over trænerens RPE."  # noqa: RUF001
    )
    [as_rx] = exercise_feel([entry(32, n, felt=0, minute=n) for n in range(4)], {8: 0.0})
    assert (
        as_rx.verdict_text == "Du melder oftest som foreskrevet – forslaget følger trænerens RPE."  # noqa: RUF001
    )
    [harder] = exercise_feel([entry(32, n, felt=1, minute=n) for n in range(4)], {8: None})
    assert harder.verdict_text == "Du melder oftest hårdere end foreskrevet."


def test_the_rescore_uses_the_coachs_rpe_on_a_main_lift_as_the_parser_does(
    make_set: MakeSet,
) -> None:
    # The tab's bench 1RM (102.5) would read 10 x 77.5 as RPE 9.2; the parser uses "RPE 5 - 7".
    s = make_set(
        week_start=MONDAY, session=1, sheet_row=30, set_no=1, type="BENCH", name="Bænk",
        reps=6.0, reps_text="5 - 7", prescribed="RPE 5 - 7", logged_kg=77.5, kg=77.5,
        muscle_factor=1.0, e1rm=102.5, score=6 * 77.5 * 0.6**2,
    )  # fmt: skip
    sets, _ = with_reps_done([s], [entry(30, reps=7.0)])
    assert (sets[0].rpe, sets[0].score) == (6.0, round(7 * 77.5 * 0.6**2, 1))
    logged = replace(s, logged_rpe=7.5)
    sets, _ = with_reps_done([logged], [entry(30, reps=7.0)])
    assert (sets[0].rpe, sets[0].score) == (7.5, round(7 * 77.5 * 0.75**2, 1))


def week_of(lift: str, start: date, e1rm_kg: float | None) -> StrengthWeek:
    return StrengthWeek(
        week_start=start, lift=lift, block=None, block_no=None, phase=None,
        status="lifted" if e1rm_kg is not None else None, sets_lifted=1, tonnage_kg=0.0,
        e1rm_kg=e1rm_kg, e1rm_load_kg=None, e1rm_reps=None, e1rm_rpe=None,
        e1rm_rpe_source=None, is_block_best=False,
    )  # fmt: skip


def test_the_rolling_e1rm_is_the_best_week_of_the_four_ending_with_the_sets_week() -> None:
    weeks = [
        week_of("SQUAT", MONDAY - timedelta(weeks=4), 190.0),  # outside the window
        week_of("SQUAT", MONDAY - timedelta(weeks=3), 170.0),
        week_of("SQUAT", MONDAY, 175.7),
        week_of("SQUAT", MONDAY + timedelta(weeks=1), 200.0),  # after the set: never used
        week_of("BENCH", MONDAY, 105.0),
    ]
    assert rolling_e1rm_at(weeks, "SQUAT", MONDAY) == 175.7
    assert rolling_e1rm_at(weeks, "DEADLIFT", MONDAY) is None


def test_a_main_lifts_percent_row_is_scored_from_the_rolling_e1rm(make_set: MakeSet) -> None:
    """A -10% squat row of 5 x 130 kg: against the tab's 180 kg it reads 72 % (RPE 4, the floor);
    against the app's rolling e1RM of 160 kg, 81 % (RPE 8.1). Rows with an RPE are left alone."""
    base = {"week_start": MONDAY, "session": 1, "type": "SQUAT", "name": "Squat", "reps": 5.0,
            "logged_kg": 130.0, "kg": 130.0, "muscle_factor": 1.0, "e1rm": 180.0}  # fmt: skip
    percent = make_set(**base, sheet_row=27, prescribed="-10%", rpe=4.0, score=0.0)
    with_rpe = make_set(**base, sheet_row=25, prescribed="RPE 7", rpe=7.0, score=0.0)
    logged = make_set(**base, sheet_row=26, prescribed="-10%", logged_rpe=8.0, rpe=8.0, score=0.0)
    tempo = make_set(**{**base, "name": "3.0.0 Tempo squat"}, sheet_row=28, prescribed="-10%",
                     rpe=6.0, score=0.0)  # fmt: skip
    weeks = [week_of("SQUAT", MONDAY - timedelta(weeks=1), 160.0)]
    out, changed = with_rolling_e1rm_rpe([percent, with_rpe, logged, tempo], weeks)
    assert changed == 1
    rpe = 10 - ((160.0 / 130.0 - 1) / 0.0333 - 5)  # 8.07
    assert out[0].rpe == pytest.approx(rpe)
    assert out[0].score == pytest.approx(round(5 * 130 * (rpe / 10) ** 2, 1))
    assert out[1:] == [with_rpe, logged, tempo]
    # No rolling e1RM yet: the tab's 1RM (the parser's estimate) stays.
    assert with_rolling_e1rm_rpe([percent], []) == ([percent], 0)


def test_compute_writes_the_final_score_back_and_keeps_the_sheets_reps(make_set: MakeSet) -> None:
    from conftest import InMemoryPostgrest
    from training_load.db.strength_sets import sync_final_scores

    db = InMemoryPostgrest()
    stored = make_set(
        week_start=MONDAY, session=1, sheet_row=32, set_no=1, type="CHEST/SHOULDERS",
        name="Low incline DB press", reps=8.0, reps_text="6 - 10", prescribed="RPE 7 - 8",
        logged_kg=30.0, kg=30.0, muscle_factor=0.6, score=81.0, rpe=7.5,
    )  # fmt: skip
    untouched = make_set(week_start=MONDAY, session=1, sheet_row=25, set_no=1, score=100.0)
    [final, same], _ = with_reps_done([stored, untouched], [entry(32, reps=10.0)])
    assert sync_final_scores(db, [stored, untouched], [final, same]) == 1
    rows = {r["sheet_row"]: r for r in db.tables["strength_sets"]}
    assert (rows[32]["reps"], rows[32]["score"]) == (8.0, 81.0)  # the sheet's own values
    assert (rows[32]["score_final"], rows[32]["rpe_final"]) == (final.score, final.rpe)
    assert rows[25]["score_final"] == 100.0
    with pytest.raises(ValueError):
        sync_final_scores(db, [stored], [same])  # sets must pair up by key
