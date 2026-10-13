"""The three answers on top of Analyse > Cykel (slice cykel-answers, user 2026-10-13; spec
design/specs/analyse.md §12, migration 20261013120000_analysis_summary.sql). Pure: no I/O.

Python owns every number, direction and sentence; the web renders them verbatim.
today = the run's Europe/Copenhagen date (= as_of). Comparisons use the rounded shown values.

eftp ("Er jeg stærkere?"): points = (day, rolling_ftp_w) of eftp_ok rides, the highest per day.
  now  = the latest point; too old when today - now > MAX_GAP_DAYS (21, where the chart line
         breaks) -> needs_data, value kept.
  then = the latest point on or before anchor = now_day - 42, no earlier than anchor - 21;
         none -> needs_data.
  delta = now - then (W); flat when |delta| / then < FLAT_SHARE. peak = the highest point since
  the first eftp_ok ride (ties: the earliest day).
ef ("Bliver min base bedre?"): points = (day, ef) of ef_ok rides. now = the median of
  ef_window(today), then = the median of ef_window(today - 42); each needs EF_MIN_RIDES rides
  (the web's trend-line rule). flat when |delta| / then < FLAT_SHARE. The detail gives each ride
  of the last 28 days that did not count one reason: no watt, under 30 min, too hard, no HR.
volume ("Træner jeg nok?"): complete ISO weeks (Sunday < today). now = the mean moving hours of
  the last 4, then = the 4 before (weeks without rides are 0 h). flat when |delta| <
  VOLUME_FLAT_H. Planned = planned_sessions dated in the last 4 weeks; per date, done =
  min(planned that date, rides that date not excluded as too_short); no plan is None, never 0.
"""

import statistics
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

from training_load.domain.ride_analysis import (
    EF_MIN_RIDES,
    ENDURANCE_MAX_IF,
    LONG_RIDE_S,
    MAX_GAP_DAYS,
    CyclingWeek,
    RideMetrics,
    ef_window,
    is_power_ride,
)

Question = Literal["eftp", "ef", "volume"]
State = Literal["answer", "needs_data"]
Direction = Literal["up", "down", "flat"]

COMPARE_DAYS: Final = 42
"""Six weeks: "now" against this many days earlier."""
FLAT_SHARE: Final = 0.03
"""eFTP and EF: a change under 3 % of the earlier value is "Uændret". About the test-retest
noise of an FTP test, and the 25th percentile of the 6-week eFTP change since 2025 (2.7 %);
EF reuses it until there are about 10 EF windows to tune on (3 EF rides on 2026-10-13)."""
VOLUME_WEEKS: Final = 4
VOLUME_FLAT_H: Final = 0.25
"""Hours per week: under a quarter hour of change (less than one extra 1-hour ride in 4 weeks)
is "Uændret"."""
VOLUME_TARGET_H: Final = 3.0
VOLUME_TARGET_SINCE: Final = date(2026, 10, 13)
"""The user's plan: 3 hours of cycling per week (user, 2026-10-13)."""

_MONTHS: Final = ("jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.",
                  "nov.", "dec.")  # fmt: skip
_MINUS: Final = "−"  # noqa: RUF001  # U+2212, the Danish minus the web also uses


@dataclass(frozen=True, slots=True)
class Answer:
    """One analysis_summary row. Missing is None, never 0 (see the migration's column comments)."""

    question: Question
    state: State
    direction: Direction | None  # None exactly when needs_data
    value: float | None
    value_date: date | None
    compare: float | None
    compare_date: date | None
    delta: float | None
    verdict_text: str
    detail_text: str | None = None
    have_n: int | None = None  # ef only
    need_n: int | None = None  # ef only
    target: float | None = None  # volume only
    target_since: date | None = None  # volume only
    planned_n: int | None = None  # volume only; None = no plan, never 0
    done_n: int | None = None  # volume only; None exactly when planned_n is None


def fmt_date(day: date, today: date) -> str:
    """Danish short date, the year only outside today's year: "7. sep. 2025", "30. aug."."""
    text = f"{day.day}. {_MONTHS[day.month - 1]}"
    return text if day.year == today.year else f"{text} {day.year}"


def _end(text: str) -> str:
    """``text`` as the end of a sentence: one full stop ("30. aug." already has it)."""
    return text if text.endswith(".") else f"{text}."


def fmt_num(value: float, decimals: int, *, signed: bool = False) -> str:
    """Decimal comma, U+2212 for negatives, "+" when ``signed`` and positive."""
    text = f"{abs(value):.{decimals}f}".replace(".", ",")
    if round(value, decimals) < 0:
        return f"{_MINUS}{text}"
    return f"+{text}" if signed and round(value, decimals) > 0 else text


def _direction(delta: float, flat: bool) -> Direction:
    return "flat" if flat else "up" if delta > 0 else "down"


def eftp_answer(metrics: Sequence[RideMetrics], *, today: date) -> Answer:
    best: dict[date, int] = {}
    for m in metrics:
        w = m.facts.rolling_ftp_w
        if m.eftp_ok and w is not None:
            best[m.facts.day] = max(w, best.get(m.facts.day, w))
    if not best:
        return Answer(
            "eftp", "needs_data", None, None, None, None, None, None,
            "Ingen eFTP endnu. Kør en tur med watt, så kan den måles.",
        )  # fmt: skip
    points = sorted(best.items())
    now_day, now_w = points[-1]
    peak_day, peak_w = min(points, key=lambda p: (-p[1], p[0]))
    detail = (
        _end(f"Det er din højeste eFTP siden {fmt_date(points[0][0], today)}")
        if now_w >= peak_w
        else _end(f"Din top er {peak_w} W fra {fmt_date(peak_day, today)}")
    )
    if (today - now_day).days > MAX_GAP_DAYS:
        latest = fmt_date(now_day, today)
        return Answer(
            "eftp", "needs_data", None, now_w, now_day, None, None, None,
            f"Din seneste eFTP er fra {_end(latest)} Kør en tur med watt, så er tallet aktuelt.",
            detail,
        )  # fmt: skip
    anchor = now_day - timedelta(days=COMPARE_DAYS)
    earlier = [p for p in points if anchor - timedelta(days=MAX_GAP_DAYS) <= p[0] <= anchor]
    if not earlier:
        return Answer(
            "eftp", "needs_data", None, now_w, now_day, None, None, None,
            f"Ingen eFTP fra omkring {fmt_date(anchor, today)} at sammenligne med.",
            detail,
        )  # fmt: skip
    then_day, then_w = earlier[-1]
    delta = now_w - then_w
    flat = abs(delta) / then_w < FLAT_SHARE
    direction = _direction(delta, flat)
    since = f"({then_w} W, {fmt_date(then_day, today)})."
    verdict = {
        "up": f"Ja: {abs(delta)} W over for 6 uger siden {since}",
        "down": f"Nej: {abs(delta)} W under for 6 uger siden {since}",
        "flat": f"Uændret: {fmt_num(delta, 0, signed=True)} W på 6 uger {since}",
    }[direction]
    return Answer(
        "eftp", "answer", direction, now_w, now_day, then_w, then_day, delta, verdict, detail
    )


def _ef_median(day: date, points: Sequence[tuple[date, float]]) -> float | None:
    values = ef_window(day, points)
    return round(statistics.median(values), 2) if len(values) >= EF_MIN_RIDES else None


_REASONS: Final = (  # (singular, plural), in the order the sentence lists them
    ("for hård", "for hårde"),
    ("uden puls", "uden puls"),
    ("uden watt", "uden watt"),
    ("under 30 min", "under 30 min"),
)


def _why_not_ef(m: RideMetrics) -> int | None:
    """Index into _REASONS for a ride that is not an EF ride, checked in this order: no power,
    short, too hard (IF >= ENDURANCE_MAX_IF), no HR. None: it counted, or no reason is known."""
    f = m.facts
    if m.ef_ok:
        return None
    if not is_power_ride(f):
        return 2
    if f.moving_s is None or f.moving_s < LONG_RIDE_S:
        return 3
    if f.if_set is not None and f.if_set >= ENDURANCE_MAX_IF:
        return 0
    return 1 if f.avg_hr is None else None


def _ef_detail(metrics: Sequence[RideMetrics], today: date) -> str | None:
    """Why the rides of the last 28 days were not easy rides with watt and HR, one reason each."""
    since = today - timedelta(days=27)
    rides = [m for m in metrics if since <= m.facts.day <= today and m.exclusion is None]
    reasons = Counter(r for r in map(_why_not_ef, rides) if r is not None)
    if not reasons:
        return None
    if len(rides) == 1:
        return f"Din seneste tur var {_REASONS[next(iter(reasons))][0]}."
    parts = [
        f"{n} {_REASONS[i][0] if n == 1 else _REASONS[i][1]}"
        for i in range(len(_REASONS))
        if (n := reasons[i])
    ]
    listed = parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} og {parts[-1]}"
    return f"Af dine {len(rides)} seneste ture var {listed}."


def ef_answer(metrics: Sequence[RideMetrics], *, today: date) -> Answer:
    points = [(m.facts.day, m.ef) for m in metrics if m.ef_ok and m.ef is not None]
    have = len(ef_window(today, points))
    now = _ef_median(today, points)
    then_end = today - timedelta(days=COMPARE_DAYS)
    then = _ef_median(then_end, points)
    detail = _ef_detail(metrics, today)
    if now is None:
        n = EF_MIN_RIDES - have
        rides = "1 rolig tur" if n == 1 else f"{n} rolige ture"
        return Answer(
            "ef", "needs_data", None, None, None, None, None, None,
            f"Kør {rides} mere med puls og watt, så kan basen måles.", detail,
            have_n=have, need_n=EF_MIN_RIDES,
        )  # fmt: skip
    if then is None:
        # Today's window holds EF_MIN_RIDES rides, so the then-window qualifies by today + 42.
        first = next(
            today + timedelta(days=i)
            for i in range(1, COMPARE_DAYS + 1)
            if _ef_median(then_end + timedelta(days=i), points) is not None
        )
        return Answer(
            "ef", "needs_data", None, now, today, None, None, None,
            _end(
                f"EF er {fmt_num(now, 2)} nu. Der er ingen rolige ture fra for 6 uger siden at "
                f"sammenligne med før {fmt_date(first, today)}"
            ),
            detail, have_n=have, need_n=EF_MIN_RIDES,
        )  # fmt: skip
    delta = round(now - then, 2)
    direction = _direction(delta, abs(delta) / then < FLAT_SHARE)
    now_t, then_t = fmt_num(now, 2), fmt_num(then, 2)
    verdict = {
        "up": f"Ja: EF er steget fra {then_t} til {now_t} på 6 uger, så du træder flere watt for "
        "samme puls.",
        "down": f"Nej: EF er faldet fra {then_t} til {now_t} på 6 uger, så du træder færre watt "
        "for samme puls.",
        "flat": f"Uændret: EF {now_t} mod {then_t} for 6 uger siden.",
    }[direction]
    return Answer(
        "ef",
        "answer",
        direction,
        now,
        today,
        then,
        then_end,
        delta,
        verdict,
        detail,
        have_n=have,
        need_n=EF_MIN_RIDES,
    )


def volume_answer(
    metrics: Sequence[RideMetrics],
    weeks: Sequence[CyclingWeek],
    planned: Sequence[date],
    *,
    today: date,
) -> Answer:
    """``planned``: one date per planned_sessions row."""
    complete = sorted(
        (w for w in weeks if w.week_start + timedelta(days=6) < today), key=lambda w: w.week_start
    )
    if len(complete) < 2 * VOLUME_WEEKS:
        raise ValueError(
            f"{len(complete)} complete weeks; the volume answer needs {2 * VOLUME_WEEKS}"
        )
    last, before = complete[-VOLUME_WEEKS:], complete[-2 * VOLUME_WEEKS : -VOLUME_WEEKS]

    def hours(ws: Sequence[CyclingWeek]) -> float:
        return round(sum(w.moving_s for w in ws) / 3600 / len(ws), 1)

    now, then = hours(last), hours(before)
    delta = round(now - then, 1)
    direction = _direction(delta, abs(delta) < VOLUME_FLAT_H)
    word = "Ja" if now >= VOLUME_TARGET_H else "Nej"
    verdict = f"{word}: {fmt_num(now, 1)} t pr. uge mod målet på {fmt_num(VOLUME_TARGET_H, 1)} t."

    first, end = last[0].week_start, last[-1].week_start + timedelta(days=6)
    plan = Counter(d for d in planned if first <= d <= end)
    ridden = Counter(
        m.facts.day for m in metrics if first <= m.facts.day <= end and m.exclusion != "too_short"
    )
    planned_n = sum(plan.values()) or None
    done_n = None if planned_n is None else sum(min(n, ridden[d]) for d, n in plan.items())
    detail = (
        "Ingen planlagte ture de sidste 4 uger."
        if planned_n is None
        else f"{done_n} af {planned_n} planlagte ture er kørt de sidste 4 uger."
    )
    return Answer(
        "volume", "answer", direction, now, None, then, before[0].week_start, delta, verdict,
        detail, target=VOLUME_TARGET_H, target_since=VOLUME_TARGET_SINCE, planned_n=planned_n,
        done_n=done_n,
    )  # fmt: skip


def cycling_answers(
    metrics: Sequence[RideMetrics],
    weeks: Sequence[CyclingWeek],
    planned: Sequence[date],
    *,
    today: date,
) -> list[Answer]:
    """The three answers, in page order: eftp, ef, volume."""
    return [
        eftp_answer(metrics, today=today),
        ef_answer(metrics, today=today),
        volume_answer(metrics, weeks, planned, today=today),
    ]
