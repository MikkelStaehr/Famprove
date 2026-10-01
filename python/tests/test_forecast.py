"""The plan-based forecast and its log (tech-lead acceptance 2, 6-9 for the strength forecast)."""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import pytest

from conftest import InMemoryPostgrest
from training_load.db.daily_projection import to_row
from training_load.db.forecast_log import log_forecast
from training_load.domain.daily import DailyLoad, build_daily_load
from training_load.domain.load import Decay
from training_load.domain.projection import (
    HORIZON_DAYS,
    NAIVE_DAYS,
    ProjectedDay,
    naive_projection,
    project,
)
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet

MakeSet = Callable[..., StrengthSet]
TODAY = date(2026, 9, 30)  # Wednesday of ISO week 40
W40, W41, W42 = date(2026, 9, 28), date(2026, 10, 5), date(2026, 10, 12)
RUN_AT = datetime(2026, 9, 30, 3, 0, tzinfo=UTC)


def history(today: date = TODAY, cycling: dict[date, float] | None = None) -> list[DailyLoad]:
    return build_daily_load(
        cycling or {}, {}, start=date(2026, 1, 1), end=today, decay=Decay.EXPONENTIAL
    )


def entries(day: ProjectedDay) -> list[dict[str, object]]:
    value = day.basis["strength"]
    assert isinstance(value, list)
    return [e for e in value if isinstance(e, dict)]


def done(week_start: date, day: date, tss: float) -> StrengthSession:
    return StrengthSession(
        week_start, 1, "s", "Program - blok 11", 5, f"i{day}", day, "Styrke", 3600, tss
    )


def block(make_set: MakeSet, weeks: tuple[date, ...]) -> list[StrengthSet]:
    """Sessions 1-3 in each week, one set each with entered kg (stored score 100)."""
    return [
        make_set(week_start=w, week=i, session=n, sheet_row=n)
        for i, w in enumerate(weeks, start=1)
        for n in (1, 2, 3)
    ]


# Three completed weeks before the block, 40 / 50 / 60 TSS: the "recent" mean 50, band 40-60.
RECENT = [
    done(date(2026, 9, 7), date(2026, 9, 8), 40.0),
    done(date(2026, 9, 14), date(2026, 9, 15), 50.0),
    done(date(2026, 9, 21), date(2026, 9, 22), 60.0),
]


def test_every_planned_session_of_the_block_is_forecast_incl_sessions_2_and_3(
    make_set: MakeSet,
) -> None:
    """AC2: each future week in the block has one entry per planned session, each scored."""
    days = project(
        history(),
        RECENT,
        block(make_set, (W40, W41, W42)),
        [],
        strength_k=0.1,
        today=TODAY,
        decay=Decay.EXPONENTIAL,
    )
    for week in (W41, W42):
        week_entries = [e for d in days if week <= d.date < week + timedelta(7) for e in entries(d)]
        assert sorted(str(e["session"]) for e in week_entries) == ["1", "2", "3"]
        assert all(e["method"] == "plan" for e in week_entries)
        assert all(e["tss"] == pytest.approx(10.0) for e in week_entries)  # score 100 x K 0.1


def test_after_the_block_the_recent_band_holds_and_inside_it_the_band_is_null(
    make_set: MakeSet,
) -> None:
    """AC6: strength_method = recent and low <= value <= high after the last prescribed week;
    band columns null inside the block (the domain and the daily_projection row)."""
    days = project(
        history(),
        RECENT,
        block(make_set, (W40, W41)),
        [],
        strength_k=0.1,
        today=TODAY,
        decay=Decay.EXPONENTIAL,
    )
    inside = [d for d in days if d.date < W42]
    after = [d for d in days if d.date >= W42]
    assert inside and after
    for d in inside:
        row = to_row(d, computed_at=RUN_AT)
        assert d.strength_method == "plan"
        assert (row["ctl_low"], row["ctl_high"], row["tsb_low"], row["tsb_high"]) == (None,) * 4
    for d in after:
        assert d.strength_method == "recent"
        for value, band in ((d.ctl, d.ctl_band), (d.atl, d.atl_band), (d.tsb, d.tsb_band)):
            assert band is not None
            low, high = band
            assert low - 1e-9 <= value <= high + 1e-9
    # The band is a real spread once recent weeks with different TSS feed it.
    last = after[-1]
    assert last.ctl_band is not None and last.ctl_band[0] < last.ctl_band[1]
    recent_days = [e for d in after for e in entries(d)]
    assert {e["method"] for e in recent_days} == {"recent"}
    for e in recent_days:  # the weekly min-max, split over the 3 sessions
        assert (e["tss_low"], e["tss_high"]) == (pytest.approx(40 / 3), pytest.approx(60 / 3))


def test_the_log_keeps_one_run_per_day_and_never_touches_earlier_days(
    db: InMemoryPostgrest,
) -> None:
    """AC7: 112 rows per run; the same day again stays 112; the next day adds 112."""

    def run(today: date, computed_at: datetime) -> int:
        days = history(today, {today - timedelta(days=3): 70.0})
        return log_forecast(
            db,
            made_on=today,
            model=project(days, [], [], [], strength_k=0.1, today=today, decay=Decay.EXPONENTIAL),
            naive=naive_projection(days, today=today, decay=Decay.EXPONENTIAL),
            params={"model_version": "test"},
            computed_at=computed_at,
        )

    assert run(TODAY, RUN_AT) == 2 * HORIZON_DAYS == 112
    first = sorted(map(str, db.tables["forecast_log"]))
    assert len(first) == 112
    later_same_day = RUN_AT + timedelta(hours=5)
    run(TODAY, later_same_day)
    rows = db.tables["forecast_log"]
    assert len(rows) == 112
    assert {r["computed_at"] for r in rows} == {later_same_day.isoformat()}  # last run wins
    snapshot = sorted(map(str, rows))
    run(TODAY + timedelta(days=1), RUN_AT + timedelta(days=1))
    rows = db.tables["forecast_log"]
    assert len(rows) == 224
    assert sorted(str(r) for r in rows if r["made_on"] == TODAY.isoformat()) == snapshot
    assert {r["method"] for r in rows} == {"model", "naive"}
    assert all(str(r["target_date"]) > str(r["made_on"]) for r in rows)


def test_naive_rows_carry_the_28_day_mean_held_flat() -> None:
    """AC8: every naive day's total TSS is the mean daily TSS of the 28 days before today."""
    load = {TODAY - timedelta(days=i): 56.0 for i in range(1, NAIVE_DAYS + 1, 2)}  # 14 days
    load[TODAY] = 500.0  # today's own load is in the seed, not in the mean
    load[TODAY - timedelta(days=NAIVE_DAYS + 1)] = 500.0  # outside the window
    naive = naive_projection(history(TODAY, load), today=TODAY, decay=Decay.EXPONENTIAL)
    assert len(naive) == HORIZON_DAYS
    assert all(d.cycling_tss + d.strength_tss == pytest.approx(28.0) for d in naive)
    assert naive[0].basis == {"naive_days": NAIVE_DAYS}


def test_strength_never_changes_the_cycling_forecast(make_set: MakeSet) -> None:
    """AC9: cycling per forecast day is the typical-week method, whatever strength does."""
    thursdays = {TODAY - timedelta(days=6 + 7 * i): 60.0 for i in range(4)}
    days = history(TODAY, thursdays)
    without = project(days, [], [], [], strength_k=0.1, today=TODAY, decay=Decay.EXPONENTIAL)
    with_strength = project(
        days,
        RECENT,
        block(make_set, (W40, W41)),
        [],
        strength_k=0.1,
        today=TODAY,
        decay=Decay.EXPONENTIAL,
    )
    assert [d.cycling_tss for d in with_strength] == [d.cycling_tss for d in without]
    assert [d.basis["cycling"] for d in with_strength] == [d.basis["cycling"] for d in without]
    assert sum(d.strength_tss for d in with_strength) > 0
