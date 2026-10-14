"""Guards on the prognose's form series (slice review-faelles, point 4).

The user saw "-50" on the form forecast. No stored daily_projection or forecast_log row was below
-23 (2026-10-14); the likely origin is the retired chart's y axis down to -50. These tests keep
each suspected cause from shipping, through the real domain.projection code:
  sign    every projected day has tsb == ctl - atl of the same day, also in the written row
  unit    the projection continues daily_load: build_daily_load over the history plus the projected
          day loads (cycling_tss + strength_tss) gives the projected ctl/atl/tsb with load.DECAY,
          and a planned session projects the TSS it scores once done (plan score x STRENGTH_K)
  input   projected TSB stays within +-TSB_BOUND on plausible inputs (synthetic and the real
          slices), and a session scored 10x its plan breaks the bound, so the guard fires
"""

import json
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Final

import pytest

from conftest import (
    SYNTHETIC_BODYWEIGHT,
    SYNTHETIC_SHEET_ID,
    Call,
    FakeResponse,
    FakeSend,
    InMemoryPostgrest,
    slice_workbook,
)
from training_load.cli import collect_strength
from training_load.config import GoogleSettings
from training_load.db.daily_projection import to_row
from training_load.db.strength_sets import all_sets
from training_load.domain.cycling import daily_cycling_tss
from training_load.domain.daily import DailyLoad, build_daily_load
from training_load.domain.load import DECAY, LoadState, ctl_atl
from training_load.domain.projection import (
    HORIZON_DAYS,
    PlannedRide,
    ProjectedDay,
    naive_projection,
    project,
)
from training_load.domain.sessions import (
    StrengthActivity,
    StrengthSession,
    daily_strength_tss,
    match_sessions,
)
from training_load.domain.strength import StrengthSet
from training_load.sources.google_drive import GOOGLE_SHEET_MIME
from training_load.sources.intervals import parse_activities

MakeSet = Callable[..., StrengthSet]

TSB_BOUND: Final = 100.0
"""|TSB| above this on a projected day is implausible for this athlete (CTL 8-30 in 2026; the
lowest stored projected TSB is -23). A breach is a wrong input, unit or sign, never a forecast."""
STRENGTH_K: Final = 0.035  # the production value since 2026-10-02 (vars.STRENGTH_K)
SERIES_START: Final = date(2026, 1, 1)
TODAY: Final = date(2026, 9, 30)  # Wednesday of ISO week 40
W40: Final = date(2026, 9, 28)
BLOCK: Final = "Program - blok 12"
RUN_AT: Final = datetime(2026, 9, 30, 3, 0, tzinfo=UTC)
RIDES_SLICE: Final = Path(__file__).parent / "fixtures" / "rides_slice.json"


def lift(day: date, activity_id: str) -> StrengthActivity:
    return StrengthActivity(
        activity_id,
        datetime.combine(day, datetime.min.time()) + timedelta(hours=17),
        "WeightTraining",
        "Styrke",
        3600,
        3600,
        None,
        None,
    )


def block_sets(make_set: MakeSet, weeks: int = 4) -> list[StrengthSet]:
    """3 sessions a week from W40 for ``weeks`` weeks, 4 entered sets each scoring 425: a
    session of 1700 x STRENGTH_K = 59.5 TSS, the ~60-TSS anchor of a heavy strength session."""
    return [
        make_set(
            block=BLOCK,
            week=w + 1,
            week_start=W40 + timedelta(weeks=w),
            session=n,
            sheet_row=10 * n + i,
            score=425.0,
        )
        for w in range(weeks)
        for n in (1, 2, 3)
        for i in range(4)
    ]


def cycling_history(end: date) -> dict[date, float]:
    """Two rides a week since SERIES_START: Thursday 60 TSS, Sunday 90 TSS."""
    rides: dict[date, float] = {}
    day = SERIES_START
    while day <= end:
        if day.weekday() == 3:
            rides[day] = 60.0
        elif day.weekday() == 6:
            rides[day] = 90.0
        day += timedelta(days=1)
    return rides


def history_sessions() -> list[StrengthSession]:
    """Sessions 1-3 done Mon/Wed/Fri in W37-W39 (the recent weeks) and session 1 Mon of W40."""
    done: list[StrengthSession] = []
    for w in range(-3, 1):
        week = W40 + timedelta(weeks=w)
        for n, offset in ((1, 0), (2, 2), (3, 4)):
            day = week + timedelta(days=offset)
            if day < TODAY:
                done.append(
                    StrengthSession(week, n, "s", BLOCK, 1, f"i{day}", day, "Styrke", 3600, 59.5)
                )
    return done


def plausible(make_set: MakeSet, *, strength_k: float = STRENGTH_K) -> list[ProjectedDay]:
    """A plan-then-recent projection on plausible inputs, with a planned ride on the horizon."""
    sessions = history_sessions()
    days = build_daily_load(
        cycling_history(TODAY), daily_strength_tss(sessions), start=SERIES_START, end=TODAY
    )
    rides = [PlannedRide(date(2026, 10, 8), "Zwift", [{"minutes": 60, "pct_ftp": 95}])]
    return project(days, sessions, block_sets(make_set), rides, today=TODAY, strength_k=strength_k)


def strength_entries(day: ProjectedDay) -> list[dict[str, object]]:
    """The basis's strength list (JSON objects), narrowed for the assertions."""
    value = day.basis["strength"]
    assert isinstance(value, list)
    return [e for e in value if isinstance(e, dict)]


def implausible(days: Sequence[ProjectedDay]) -> list[tuple[date, float]]:
    """The projected days whose TSB is out of bounds, as (date, tsb)."""
    return [(d.date, round(d.tsb, 1)) for d in days if not -TSB_BOUND <= d.tsb <= TSB_BOUND]


def assert_continues(history: Sequence[DailyLoad], projected: Sequence[ProjectedDay]) -> None:
    """build_daily_load over history + the projected day loads == the projected ctl/atl/tsb."""
    cycling = {d.date: d.cycling_tss for d in history} | {d.date: d.cycling_tss for d in projected}
    strength = {d.date: d.strength_tss for d in history} | {
        d.date: d.strength_tss for d in projected
    }
    extended = build_daily_load(cycling, strength, start=history[0].date, end=projected[-1].date)[
        len(history) :
    ]
    assert [d.date for d in extended] == [d.date for d in projected]
    for want, got in zip(extended, projected, strict=True):
        assert (got.ctl, got.atl, got.tsb) == pytest.approx(
            (want.ctl, want.atl, want.tsb), abs=1e-9
        ), got.date


# --- (a) sign -----------------------------------------------------------------------------------


def test_every_projected_day_has_tsb_equal_to_ctl_minus_atl_of_the_same_day(
    make_set: MakeSet,
) -> None:
    days = plausible(make_set)
    assert len(days) == HORIZON_DAYS
    assert {d.strength_method for d in days} == {"plan", "recent"}  # both regimes are covered
    for d in days:
        assert d.tsb == pytest.approx(d.ctl - d.atl, abs=1e-9), d.date
        row = to_row(d, computed_at=RUN_AT)  # what daily_projection stores and the web draws
        assert row["tsb"] == pytest.approx(row["ctl"] - row["atl"], abs=1e-9), d.date
    # A sign flip (atl - ctl) or a day shift would also break this: after a week of hard plan
    # days fatigue leads, so form is negative, and it recovers on the rest days of the horizon.
    assert min(d.tsb for d in days) < 0 < max(d.atl for d in days)


def test_the_naive_baseline_has_tsb_equal_to_ctl_minus_atl_of_the_same_day() -> None:
    days = build_daily_load(cycling_history(TODAY), {}, start=SERIES_START, end=TODAY)
    naive = naive_projection(days, today=TODAY)
    assert len(naive) == HORIZON_DAYS
    for d in naive:
        assert d.tsb == pytest.approx(d.ctl - d.atl, abs=1e-9), d.date


# --- (b) unit and decay -------------------------------------------------------------------------


def test_the_projection_continues_daily_load_with_the_same_decay_and_tss(
    make_set: MakeSet,
) -> None:
    """Seeded from today's row (not yesterday's, not zero), each day's load counted once, with
    load.DECAY: compute passes DECAY explicitly, the default must agree with it."""
    sessions = history_sessions()
    history = build_daily_load(
        cycling_history(TODAY), daily_strength_tss(sessions), start=SERIES_START, end=TODAY
    )
    projected = project(history, sessions, block_sets(make_set), [], today=TODAY, strength_k=0.035)
    assert_continues(history, projected)
    explicit = project(
        history, sessions, block_sets(make_set), [], today=TODAY, strength_k=0.035, decay=DECAY
    )
    assert [d.tsb for d in explicit] == [d.tsb for d in projected]


def test_replaying_the_projected_loads_from_todays_ctl_atl_gives_the_projected_series(
    make_set: MakeSet,
) -> None:
    sessions = history_sessions()
    history = build_daily_load(
        cycling_history(TODAY), daily_strength_tss(sessions), start=SERIES_START, end=TODAY
    )
    projected = project(history, sessions, block_sets(make_set), [], today=TODAY, strength_k=0.035)
    seed = LoadState(ctl=history[-1].ctl, atl=history[-1].atl, tsb=history[-1].tsb)
    replay = ctl_atl([d.cycling_tss + d.strength_tss for d in projected], initial=seed)
    for st, d in zip(replay, projected, strict=True):
        assert (d.ctl, d.atl, d.tsb) == pytest.approx((st.ctl, st.atl, st.tsb), abs=1e-9), d.date


def test_a_planned_session_projects_the_tss_it_scores_when_done(make_set: MakeSet) -> None:
    """The unit: projected strength TSS = plan score x STRENGTH_K, exactly what match_sessions
    puts into daily_load once the session is done (not the raw score, not K twice)."""
    sets = block_sets(make_set, weeks=2)
    week_41 = W40 + timedelta(weeks=1)
    tuesday = week_41 + timedelta(days=1)
    projected = project(
        build_daily_load({}, {}, start=SERIES_START, end=TODAY),
        [],
        sets,
        [],
        today=TODAY,
        strength_k=STRENGTH_K,
    )
    [first] = [
        e
        for d in projected
        if week_41 <= d.date < week_41 + timedelta(days=7)
        for e in strength_entries(d)
        if e["session"] == 1
    ]
    [done] = [
        s
        for s in match_sessions(sets, [lift(tuesday, "g1")], STRENGTH_K)
        if s.week_start == week_41 and s.session == 1
    ]
    assert first["tss"] == pytest.approx(done.tss) == pytest.approx(1700 * STRENGTH_K)


# --- (c) plausibility bound ---------------------------------------------------------------------


def test_projected_form_stays_within_bounds_on_plausible_inputs(make_set: MakeSet) -> None:
    days = plausible(make_set)
    assert implausible(days) == []
    assert all(-TSB_BOUND <= t <= TSB_BOUND for d in days if d.tsb_band for t in d.tsb_band)


def test_a_session_scored_10x_its_plan_breaks_the_bound(make_set: MakeSet) -> None:
    """The guard must fire: 10x the strength TSS (a unit slip, e.g. K x 10 or a score in the wrong
    scale) drives form far below the plausible floor within the first plan week."""
    days = plausible(make_set, strength_k=10 * STRENGTH_K)
    breaches = implausible(days)
    assert breaches, "a 10x strength load must be visible to the plausibility bound"
    assert all(tsb < -TSB_BOUND for _, tsb in breaches)  # fatigue-led: the sign is negative
    assert breaches[0][0] < W40 + timedelta(weeks=2)


# --- real-data slices ---------------------------------------------------------------------------


@pytest.fixture
def real_sets(db: InMemoryPostgrest, monkeypatch: pytest.MonkeyPatch) -> list[StrengthSet]:
    """The blok 12 slice through collect-strength (in memory, read-only fake Drive)."""
    monkeypatch.setattr(collect_strength, "access_token", lambda _info: "fake-token")
    workbook = slice_workbook()

    def handler(call: Call) -> FakeResponse:
        assert call.method == "GET", "Drive must only ever be read"
        if dict(call.params or []).get("fields") == "mimeType":
            return FakeResponse(body={"mimeType": GOOGLE_SHEET_MIME})
        return FakeResponse(raw=workbook)

    collect_strength.run(
        GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={}),
        bodyweight=SYNTHETIC_BODYWEIGHT,
        send=FakeSend(handler=handler),
        db=db,
    )
    return all_sets(db)


def test_the_real_slices_project_a_plausible_form_with_tsb_equal_to_ctl_minus_atl(
    real_sets: list[StrengthSet],
) -> None:
    """Real magnitudes: the blok 12 slice's plan (week 1 done, weeks 2-4 planned) and the real
    rides as cycling history, moved by whole weeks (weekdays kept) so the last ride falls in the
    week before the strength slice's today."""
    first_week = min(s.week_start for s in real_sets)
    today = first_week + timedelta(days=2)  # Wednesday of the slice's first week
    sessions = match_sessions(real_sets, [lift(first_week + timedelta(days=1), "g1")], STRENGTH_K)
    assert [s.tss > 0 for s in sessions if s.date] == [True]

    doc = json.loads(RIDES_SLICE.read_text(encoding="utf-8"))
    raw = daily_cycling_tss(parse_activities(doc["rides"]).cycling)
    weeks = -(-((max(raw) - today).days + 1) // 7)
    cycling = {d - timedelta(weeks=weeks): t for d, t in raw.items()}
    start = min(cycling)
    assert today - timedelta(days=7) <= max(cycling) < today

    history = build_daily_load(cycling, daily_strength_tss(sessions), start=start, end=today)
    projected = project(history, sessions, real_sets, [], today=today, strength_k=STRENGTH_K)
    assert {d.strength_method for d in projected} == {"plan", "recent"}
    assert sum(d.strength_tss for d in projected) > 0
    for d in projected:
        assert d.tsb == pytest.approx(d.ctl - d.atl, abs=1e-9), d.date
    assert_continues(history, projected)
    assert implausible(projected) == []
