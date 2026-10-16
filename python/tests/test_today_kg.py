"""Fokus's "I DAG" kg (slice fokus-kg, user 2026-10-15), on exactly the sheet's deadlift rows
77-79 of blok 12, week 3 (session 2): 142.5 @ RPE 6 x 3, 145 @ RPE 7 x 3, 127.5 @ -12.5 % x 5 (2
sets); week 2: 140, 145, 130."""

from dataclasses import replace
from datetime import date

from training_load.domain.e1rm import round_to_step
from training_load.domain.strength import StrengthSet
from training_load.domain.today_kg import TodayKg, percent, ref, today_kgs

W2, W3 = date(2026, 10, 5), date(2026, 10, 12)


def _set(
    row: int, set_no: int, week_start: date, prescribed: str, reps: float, kg: float | None
) -> StrengthSet:
    return StrengthSet(
        sheet_id="s", block="Program - blok 12", sheet_row=row, week=3 if week_start == W3 else 2,
        set_no=set_no, week_start=week_start, session=2, type="DEADLIFT", name="Dødløft",
        reps=reps, logged_kg=kg, kg=kg or 0.0, bodyweight=False, rpe=None, score=0.0,
        prescribed=prescribed,
    )  # fmt: skip


def _rows(w3: tuple[float | None, float | None, float | None]) -> list[StrengthSet]:
    a, b, c = w3
    return [
        _set(77, 1, W2, "RPE 5.5", 3, 140), _set(78, 1, W2, "RPE 6.5", 3, 145),
        _set(79, 1, W2, "-10%", 5, 130), _set(79, 2, W2, "-10%", 5, 130),
        _set(77, 1, W3, "RPE 6", 3, a), _set(78, 1, W3, "RPE 7", 3, b),
        _set(79, 1, W3, "-12.5%", 5, c), _set(79, 2, W3, "-12.5%", 5, c),
    ]  # fmt: skip


def _today(
    sets: list[StrengthSet], suggested: dict[int, float | None] | None = None
) -> list[TodayKg]:
    sug = {ref(s): (suggested or {}).get(s.sheet_row) for s in sets if s.week_start == W3}
    got = today_kgs(sets, sug, run_week=W3, statuses={})
    return [got[ref(s)] for s in sets if s.week_start == W3]


def test_the_sheet_kg_is_today_kg() -> None:
    sheet = [TodayKg(142.5, "sheet"), TodayKg(145, "sheet"), TodayKg(127.5, "sheet")]
    assert _today(_rows((142.5, 145, 127.5))) == [*sheet, sheet[-1]]


def test_a_blank_rpe_row_comes_from_the_highest_rpe_sibling() -> None:
    # 145 x (1 + .0333 x (3 + 10 - 7)) / (1 + .0333 x (3 + 10 - 6)) = 141.08 -> 140
    assert _today(_rows((None, 145, 127.5)))[0] == TodayKg(140.0, "derived")


def test_a_blank_backoff_is_its_share_of_the_heaviest_kg() -> None:
    # 0.875 x 145 = 126.875 -> 127.5, the sheet's own X79
    assert _today(_rows((142.5, 145, None)))[2:] == [TodayKg(127.5, "derived")] * 2


def test_with_no_sheet_kg_the_estimates_and_the_backoff_follow_them() -> None:
    assert _today(_rows((None, None, None)), {77: 140, 78: 145, 79: None}) == [
        TodayKg(140, "e1rm"), TodayKg(145, "e1rm"), TodayKg(127.5, "e1rm"), TodayKg(127.5, "e1rm"),
    ]  # fmt: skip


def test_with_nothing_else_it_is_last_weeks_kg() -> None:
    assert _today(_rows((None, None, None))) == [
        TodayKg(140, "last"), TodayKg(145, "last"), TodayKg(130, "last"), TodayKg(130, "last"),
    ]  # fmt: skip


def test_bodyweight_zero_is_a_kg_and_helpers() -> None:
    dips = replace(_set(80, 1, W3, "RPE 8", 8, 0.0), name="Dips", bodyweight=True)
    assert today_kgs([dips], {}, run_week=W3, statuses={})[ref(dips)] == TodayKg(0.0, "sheet")
    assert round_to_step(126.875) == 127.5 and round_to_step(141.08) == 140.0
    assert percent("-12.5%") == -0.125 and percent("-10 %") == -0.10
    assert percent("75%") is None and percent("RPE 7") is None


def test_same_as_last_needs_the_same_exercise_variant_and_reps() -> None:
    sets = _rows((None, None, None))
    sets[4] = replace(sets[4], variant_id=7)  # row 77 is a named variant this week
    sets[5] = replace(sets[5], reps=5)  # row 78 has other reps than last week's
    got = today_kgs(sets, {}, run_week=W3, statuses={})
    assert ref(sets[4]) not in got  # last week's plain deadlift is no anchor for a variant
    assert ref(sets[5]) not in got  # nor last week's 3 reps for 5
    assert got[ref(sets[6])] == TodayKg(130, "last")  # the back-off row still matches


def test_percent_rejects_what_is_no_backoff() -> None:
    for text in ("-nan%", "-inf%", "-100%", "-150%", "-0%", "10%", "75%", "abc"):
        assert percent(text) is None, text
