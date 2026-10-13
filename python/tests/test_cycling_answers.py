"""The three Analyse > Cykel answers (domain.cycling_answers, slice cykel-answers, 2026-10-13)."""

from collections.abc import Mapping
from dataclasses import replace
from datetime import date, timedelta

import pytest

from training_load.domain.cycling_answers import (
    VOLUME_TARGET_H,
    Answer,
    cycling_answers,
    ef_answer,
    eftp_answer,
    fmt_date,
    fmt_num,
    volume_answer,
)
from training_load.domain.ride_analysis import (
    EF_MIN_RIDES,
    RideFacts,
    RideMetrics,
    analyse_rides,
    weekly_totals,
)

TODAY = date(2026, 10, 13)  # a Tuesday

# An easy ride: IF 0.72, 60 min, NP 180 W / HR 150 -> EF 1.20, eFTP 200 W.
EASY = RideFacts(
    activity_id="i0",
    day=TODAY,
    type="Ride",
    has_raw=True,
    moving_s=3600,
    distance_m=30_000.0,
    load=60,
    np_w=180,
    avg_hr=150,
    device_watts=True,
    ftp_w=230,
    if_set=0.72,
    rolling_ftp_w=200,
)


Spec = tuple[date, Mapping[str, object]]


def rides(*specs: Spec) -> list[RideMetrics]:
    facts = [
        replace(EASY, activity_id=f"i{n}", day=day, **changes)  # type: ignore[arg-type]
        for n, (day, changes) in enumerate(specs)
    ]
    return analyse_rides(facts)


def hard(day: date, eftp: int) -> Spec:
    return day, {"if_set": 0.85, "rolling_ftp_w": eftp}


def test_danish_numbers_and_dates() -> None:
    assert fmt_num(-5, 0, signed=True) == "−5"  # noqa: RUF001
    assert fmt_num(3, 0, signed=True) == "+3"
    assert fmt_num(0, 0, signed=True) == "0"
    assert fmt_num(0.93, 1) == "0,9"
    assert fmt_num(1.2, 2) == "1,20"
    assert fmt_date(date(2025, 9, 7), TODAY) == "7. sep. 2025"
    assert fmt_date(date(2026, 8, 30), TODAY) == "30. aug."
    assert fmt_date(date(2026, 5, 6), TODAY) == "6. maj"


def test_eftp_today_minus_5_w_is_inside_the_flat_band() -> None:
    """The real numbers of 2026-10-13: 183 W (11 Oct) vs 188 W (30 Aug), peak 233 W."""
    metrics = rides(
        hard(date(2025, 9, 7), 233),
        hard(date(2026, 8, 30), 188),
        hard(date(2026, 10, 11), 183),
    )
    a = eftp_answer(metrics, today=TODAY)
    assert (a.state, a.direction, a.value, a.compare, a.delta) == ("answer", "flat", 183, 188, -5)
    assert (a.value_date, a.compare_date) == (date(2026, 10, 11), date(2026, 8, 30))
    assert a.verdict_text == "Uændret: −5 W på 6 uger (188 W, 30. aug.)."  # noqa: RUF001
    assert a.detail_text == "Din top er 233 W fra 7. sep. 2025."


@pytest.mark.parametrize(
    ("then_w", "now_w", "direction", "verdict"),
    [
        (180, 190, "up", "Ja: 10 W over for 6 uger siden (180 W, 30. aug.)."),
        (200, 190, "down", "Nej: 10 W under for 6 uger siden (200 W, 30. aug.)."),
        (200, 195, "flat", "Uændret: \u22125 W på 6 uger (200 W, 30. aug.)."),  # 2.5 %
        (200, 194, "down", "Nej: 6 W under for 6 uger siden (200 W, 30. aug.)."),  # 3.0 %: real
        (200, 200, "flat", "Uændret: 0 W på 6 uger (200 W, 30. aug.)."),
    ],
)
def test_eftp_direction_uses_the_3_percent_band(
    then_w: int, now_w: int, direction: str, verdict: str
) -> None:
    metrics = rides(hard(date(2026, 8, 30), then_w), hard(date(2026, 10, 11), now_w))
    a = eftp_answer(metrics, today=TODAY)
    assert (a.direction, a.verdict_text) == (direction, verdict)


def test_eftp_at_its_peak_says_since_when() -> None:
    a = eftp_answer(rides(hard(date(2026, 8, 30), 180), hard(date(2026, 10, 11), 190)), today=TODAY)
    assert a.detail_text == "Det er din højeste eFTP siden 30. aug."  # one full stop, not two


def test_eftp_needs_data_states_keep_the_number() -> None:
    stale = eftp_answer(rides(hard(date(2026, 9, 1), 186)), today=TODAY)
    assert (stale.state, stale.direction, stale.value, stale.compare) == (
        "needs_data",
        None,
        186,
        None,
    )
    assert stale.verdict_text == (
        "Din seneste eFTP er fra 1. sep. Kør en tur med watt, så er tallet aktuelt."
    )
    no_then = eftp_answer(rides(hard(date(2026, 10, 11), 183)), today=TODAY)
    assert (no_then.state, no_then.value) == ("needs_data", 183)
    assert no_then.verdict_text == "Ingen eFTP fra omkring 30. aug. at sammenligne med."
    # The "then" ride must be within 21 days before the anchor (30 Aug): 8 Aug is too early.
    too_early = eftp_answer(
        rides(hard(date(2026, 8, 8), 190), hard(date(2026, 10, 11), 183)), today=TODAY
    )
    assert too_early.state == "needs_data"
    none = eftp_answer([], today=TODAY)
    assert (none.state, none.value, none.detail_text) == ("needs_data", None, None)
    assert none.verdict_text == "Ingen eFTP endnu. Kør en tur med watt, så kan den måles."


def test_ef_says_how_many_easy_rides_are_missing() -> None:
    none = ef_answer([], today=TODAY)
    assert (none.state, none.value, none.have_n, none.need_n) == ("needs_data", None, 0, 3)
    assert none.verdict_text == "Kør 3 rolige ture mere med puls og watt, så kan basen måles."
    two = ef_answer(rides((TODAY - timedelta(days=3), {}), (TODAY, {})), today=TODAY)
    assert (two.have_n, two.verdict_text) == (
        2,
        "Kør 1 rolig tur mere med puls og watt, så kan basen måles.",
    )


def test_ef_answer_compares_the_two_28_day_medians() -> None:
    then_end = TODAY - timedelta(days=42)
    metrics = rides(
        *((then_end - timedelta(days=d), {"np_w": 165}) for d in (0, 5, 10)),  # EF 1.10
        *((TODAY - timedelta(days=d), {}) for d in (0, 5, 10)),  # EF 1.20
    )
    a = ef_answer(metrics, today=TODAY)
    assert (a.state, a.direction, a.value, a.compare, a.delta) == ("answer", "up", 1.2, 1.1, 0.1)
    assert (a.value_date, a.compare_date) == (TODAY, then_end)
    assert a.verdict_text == (
        "Ja: EF er steget fra 1,10 til 1,20 på 6 uger, så du træder flere watt for samme puls."
    )
    assert a.detail_text is None  # every recent ride was an easy ride with HR


def test_ef_now_without_then_says_from_when_it_can_compare() -> None:
    now: list[Spec] = [(TODAY - timedelta(days=d), {}) for d in (0, 5, 10)]
    alone = ef_answer(rides(*now), today=TODAY)
    assert (alone.state, alone.value, alone.compare) == ("needs_data", 1.2, None)
    # Today's rides are the comparison 6 weeks from now.
    assert alone.verdict_text == (
        "EF er 1,20 nu. Der er ingen rolige ture fra for 6 uger siden at sammenligne med "
        "før 24. nov."
    )
    # Three easy rides 30 days ago: a window ending D - 42 holds them from D = today + 12.
    older: list[Spec] = [(TODAY - timedelta(days=30 + d), {}) for d in (0, 1, 2)]
    later = ef_answer(rides(*now, *older), today=TODAY)
    assert later.verdict_text.endswith("at sammenligne med før 25. okt.")


def test_ef_detail_counts_why_recent_rides_did_not_count() -> None:
    metrics = rides(
        (TODAY - timedelta(days=1), {"if_set": 0.85}),
        (TODAY - timedelta(days=8), {"if_set": 0.79}),
        (TODAY - timedelta(days=15), {"avg_hr": None}),
        (TODAY - timedelta(days=40), {"if_set": 0.9}),  # outside the 28 days
    )
    assert ef_answer(metrics, today=TODAY).detail_text == (
        "Af dine 3 seneste ture var 2 for hårde og 1 uden puls."
    )
    one = ef_answer(rides((TODAY - timedelta(days=2), {"if_set": 0.9})), today=TODAY)
    assert one.detail_text == "Din seneste tur var for hård."
    no_hr = ef_answer(rides((TODAY - timedelta(days=2), {"avg_hr": None})), today=TODAY)
    assert no_hr.detail_text == "Din seneste tur var uden puls."


MONDAYS = [TODAY - timedelta(days=1 + 7 * k) for k in range(8, 0, -1)]  # 8 complete weeks


def week_rides(hours: list[float]) -> list[RideMetrics]:
    return rides(
        *(
            (monday + timedelta(days=2), {"moving_s": round(h * 3600)})
            for monday, h in zip(MONDAYS, hours, strict=True)
            if h
        )
    )


def test_volume_today_is_0_9_h_against_3_h_without_a_plan() -> None:
    metrics = week_rides([1.0, 1.0, 1.0, 1.0, 1.99, 0, 0, 1.73])
    weeks = weekly_totals(metrics, first=MONDAYS[0], last=TODAY)
    a = volume_answer(metrics, weeks, [], today=TODAY)
    assert (a.state, a.direction, a.value, a.compare, a.delta) == ("answer", "flat", 0.9, 1.0, -0.1)
    assert a.compare_date == MONDAYS[0]
    assert a.verdict_text == "Nej: 0,9 t pr. uge mod målet på 3,0 t."
    assert (a.planned_n, a.done_n, a.detail_text) == (
        None,
        None,
        "Ingen planlagte ture de sidste 4 uger.",
    )
    assert (a.target, a.value_date) == (VOLUME_TARGET_H, None)


def test_volume_counts_planned_sessions_done_per_date() -> None:
    metrics = week_rides([0, 0, 0, 0, 3, 3, 3, 3.4])
    weeks = weekly_totals(metrics, first=MONDAYS[0], last=TODAY)
    ride_days = [m.facts.day for m in metrics]
    planned = [
        ride_days[-1],
        ride_days[-1],  # two planned on a day with one ride: 1 done
        ride_days[-2],
        MONDAYS[-1] + timedelta(days=5),  # no ride that day
        MONDAYS[0],  # before the 4 weeks: not counted
    ]
    a = volume_answer(metrics, weeks, planned, today=TODAY)
    assert (a.direction, a.value, a.verdict_text) == (
        "up",
        3.1,
        "Ja: 3,1 t pr. uge mod målet på 3,0 t.",
    )
    assert (a.planned_n, a.done_n) == (4, 2)
    assert a.detail_text == "2 af 4 planlagte ture er kørt de sidste 4 uger."


def test_the_current_week_never_counts() -> None:
    metrics = week_rides([1, 1, 1, 1, 1, 1, 1, 1]) + rides((TODAY, {"moving_s": 36000}))
    weeks = weekly_totals(metrics, first=MONDAYS[0], last=TODAY)
    assert volume_answer(metrics, weeks, [], today=TODAY).value == 1.0


def test_three_rows_in_page_order_and_answer_rows_are_complete() -> None:
    metrics = week_rides([1.0] * 8)
    weeks = weekly_totals(metrics, first=MONDAYS[0], last=TODAY)
    answers = cycling_answers(metrics, weeks, [], today=TODAY)
    assert [a.question for a in answers] == ["eftp", "ef", "volume"]
    for a in answers:
        assert isinstance(a, Answer)
        assert (a.direction is None) == (a.state == "needs_data")
    assert answers[1].need_n == EF_MIN_RIDES
