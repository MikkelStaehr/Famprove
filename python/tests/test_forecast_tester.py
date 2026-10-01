"""Tester's edge cases for the plan-based strength forecast and forecast_log (commit 407149f).

All data is synthetic. Complements test_planned_load.py and test_forecast.py: the end-to-end path
through compute.run, real parsed sets, messy prescribed cells and the block/deload boundaries.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import pytest

from conftest import (
    BLOK_12,
    FIXED_TODAY,
    SYNTHETIC_BODYWEIGHT,
    SYNTHETIC_SHEET_ID,
    Call,
    FakeResponse,
    FakeSend,
    InMemoryPostgrest,
    raw_ride,
)
from training_load.cli import collect_strength, compute
from training_load.config import GoogleSettings
from training_load.db.activities import upsert_activities
from training_load.db.strength_activities import upsert_strength_activities
from training_load.db.strength_sets import all_sets
from training_load.domain.daily import DailyLoad, build_daily_load
from training_load.domain.load import Decay
from training_load.domain.planned_load import planned_session_score
from training_load.domain.projection import (
    HORIZON_DAYS,
    NAIVE_DAYS,
    ProjectedDay,
    naive_projection,
    project,
    recent_weeks,
)
from training_load.domain.sessions import StrengthSession
from training_load.domain.strength import StrengthSet
from training_load.sources.google_drive import GOOGLE_SHEET_MIME
from training_load.sources.intervals import parse_activities
from training_load.sources.strength_sheet import set_score

MakeSet = Callable[..., StrengthSet]
GOOGLE = GoogleSettings(sheet_id=SYNTHETIC_SHEET_ID, service_account_info={})
TODAY = date(2026, 9, 30)  # Wednesday, ISO week 40
W40, W41, W42, W43 = (date(2026, 9, 28) + timedelta(weeks=i) for i in range(4))
RUN_AT = datetime(2026, 3, 15, 3, 0, tzinfo=UTC)
BLOK = "Program - blok 12"


@pytest.fixture(autouse=True)
def fake_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(collect_strength, "access_token", lambda _info: "fake-token")


def drive(workbook: bytes) -> FakeSend:
    def handler(call: Call) -> FakeResponse:
        assert call.method == "GET", "Drive must only ever be read"
        if dict(call.params or []).get("fields") == "mimeType":
            return FakeResponse(body={"mimeType": GOOGLE_SHEET_MIME})
        return FakeResponse(raw=workbook)

    return FakeSend(handler=handler)


def history(today: date = TODAY, cycling: dict[date, float] | None = None) -> list[DailyLoad]:
    return build_daily_load(
        cycling or {}, {}, start=date(2026, 1, 1), end=today, decay=Decay.EXPONENTIAL
    )


def entries(day: ProjectedDay) -> list[dict[str, object]]:
    value = day.basis["strength"]
    assert isinstance(value, list)
    return [e for e in value if isinstance(e, dict)]


def done(week_start: date, day: date, tss: float, session: int = 1) -> StrengthSession:
    return StrengthSession(week_start, session, "s", BLOK, 1, f"i{day}", day, "Styrke", 3600, tss)


def planned(make_set: MakeSet, **overrides: object) -> StrengthSet:
    """A future prescribed set: no kg logged, nothing stored as score."""
    base: dict[str, object] = {
        "block": BLOK,
        "week": 2,
        "week_start": W41,
        "session": 1,
        "logged_kg": None,
        "kg": 0.0,
        "score": 0.0,
        "rpe": 6.0,
        "type": "SQUAT",
        "name": "Squat",
        "reps": 5.0,
        "e1rm": 150.0,
    }
    return make_set(**(base | overrides))


def week_tss(days: list[ProjectedDay], week: date) -> float:
    return sum(d.strength_tss for d in days if week <= d.date < week + timedelta(days=7))


# --- planned_load: messy prescribed cells and backoff edges ------------------------------------


def test_rpe_8_squat_from_e1rm_150_plans_121_6_kg_and_scores_389_3(make_set: MakeSet) -> None:
    """AC4, with the kg checked too: score = 5 x kg x 0.8^2 x 1.0, so kg = score / 3.2."""
    result = planned_session_score([planned(make_set, prescribed="RPE 8")], [])
    assert result.score == pytest.approx(389.3, abs=0.1)
    assert result.score / (5 * 0.8**2) == pytest.approx(121.6, abs=0.1)


def test_a_backoff_without_any_top_set_is_unscored_not_zero(make_set: MakeSet) -> None:
    backoff = planned(make_set, prescribed="-10%", sheet_row=11)
    result = planned_session_score([backoff], [])
    assert (result.score, result.unscored, result.sources) == (0.0, 1, {})


def test_a_backoff_follows_an_entered_top_set_at_90_percent(make_set: MakeSet) -> None:
    top = planned(make_set, prescribed="RPE 8", logged_kg=120.0, kg=120.0, score=300.0)
    backoff = planned(make_set, prescribed="-10%", sheet_row=11, reps=5.0)
    result = planned_session_score([top, backoff], [])
    assert result.sources == {"entered": 1, "backoff": 1}
    # The backoff is scored by the unchanged formula at 108 kg (90% of the entered 120 kg).
    scored: object = set_score("SQUAT", "Squat", 5.0, 108.0, "-10%", 0.0, {"SQUAT": 150.0})  # type: ignore[no-untyped-call]  # untyped legacy formula module
    assert isinstance(scored, tuple)
    assert result.score == pytest.approx(300.0 + float(scored[2]))


def test_a_percent_cell_with_a_comma_decimal_reads_like_a_dot(make_set: MakeSet) -> None:
    comma = planned_session_score([planned(make_set, prescribed="72,5%")], [])
    dot = planned_session_score([planned(make_set, prescribed="72.5%")], [])
    assert comma.sources == dot.sources == {"pct_e1rm": 1}
    assert comma.score == pytest.approx(dot.score)


def test_an_rpe_cell_with_a_comma_decimal_reads_like_a_dot(make_set: MakeSet) -> None:
    """Messy input: "RPE 7,5" is 7.5, not the mean of 7 and 5 (= 6)."""
    comma = planned_session_score([planned(make_set, prescribed="RPE 7,5")], [])
    dot = planned_session_score([planned(make_set, prescribed="RPE 7.5")], [])
    assert comma.score == pytest.approx(dot.score)


def test_entered_kg_sets_from_the_parsed_workbook_forecast_their_stored_score(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    """AC3 on real parser output (text kg, bodyweight, tempo, ABS rows), not a hand-set score."""
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook_bytes), db=db)
    sets = all_sets(db)
    entered = [s for s in sets if s.logged_kg is not None]
    assert len(entered) >= 10
    for s in entered:
        result = planned_session_score([s], sets)
        assert result.score == pytest.approx(s.score), s
        assert result.unscored == 0, s


# --- project(): deload, partial scoring, block end ----------------------------------------------


def test_a_deload_week_forecasts_less_strength_tss_than_the_week_before(
    make_set: MakeSet,
) -> None:
    """AC5 through project(): fewer sets and a lower RPE in W42 give a lower week total."""
    normal = [
        planned(make_set, week=2, week_start=W41, prescribed="RPE 8", set_no=n) for n in (1, 2, 3)
    ]
    deload = [
        planned(make_set, week=3, week_start=W42, prescribed="RPE 6", set_no=n) for n in (1, 2)
    ]
    days = project(
        history(), [], normal + deload, [], strength_k=0.1, today=TODAY, decay=Decay.EXPONENTIAL
    )
    assert 0 < week_tss(days, W42) < week_tss(days, W41)


def test_a_partly_unscored_session_counts_its_scored_sets_and_lists_the_rest(
    make_set: MakeSet,
) -> None:
    """AC2: tss > 0 or a reason. One session with a known squat and an unknown accessory, one
    session with only unknowns."""
    sets = [
        planned(make_set, session=1, prescribed="RPE 8"),
        planned(make_set, session=1, type="BACK", name="New row", e1rm=None, sheet_row=20),
        planned(make_set, session=2, type="BACK", name="New curl", e1rm=None, sheet_row=30),
    ]
    days = project(history(), [], sets, [], strength_k=0.1, today=TODAY, decay=Decay.EXPONENTIAL)
    in_w41 = [e for d in days if W41 <= d.date < W42 for e in entries(d)]
    by_session = {e["session"]: e for e in in_w41}
    assert set(by_session) == {1, 2} and len(in_w41) == 2
    assert {e["method"] for e in in_w41} == {"plan"}
    one, two = by_session[1], by_session[2]
    assert one["tss"] == pytest.approx(38.93, abs=0.01) and one["unscored"] == 1
    assert two["tss"] is None and two["reason"] == "no kg for any set in the plan"


def test_a_block_ending_on_sunday_keeps_that_sunday_in_the_plan_and_monday_is_recent(
    make_set: MakeSet,
) -> None:
    """The last prescribed week (W41) ends Sunday 11 Oct; session 2 is learnt on Sundays."""
    sundays = [W40 - timedelta(weeks=i) + timedelta(days=6) for i in range(1, 4)]
    sessions = [done(d - timedelta(days=6), d, 30.0, session=2) for d in sundays] + [
        done(d - timedelta(days=6), d - timedelta(days=6), 30.0) for d in sundays
    ]
    sets = [planned(make_set, session=n, prescribed="RPE 8", sheet_row=n) for n in (1, 2)]
    days = {
        d.date: d
        for d in project(
            history(), sessions, sets, [], strength_k=0.1, today=TODAY, decay=Decay.EXPONENTIAL
        )
    }
    sunday, monday = W41 + timedelta(days=6), W42
    assert [e["session"] for e in entries(days[sunday])] == [2]
    assert entries(days[sunday])[0]["method"] == "plan"
    assert days[sunday].strength_method == "plan" and days[sunday].ctl_band is None
    assert days[monday].strength_method == "recent" and days[monday].ctl_band is not None
    assert [e["method"] for e in entries(days[monday])] == ["recent"]


def test_a_deload_week_is_left_out_of_the_recent_mean_and_band() -> None:
    sessions = [
        done(date(2026, 9, 7), date(2026, 9, 8), 40.0),
        done(date(2026, 9, 14), date(2026, 9, 15), 50.0),
        done(date(2026, 9, 21), date(2026, 9, 22), 10.0),  # deload
    ]
    with_deload = recent_weeks(sessions, TODAY)
    without = recent_weeks(sessions, TODAY, deload_weeks={date(2026, 9, 21)})
    assert with_deload is not None and with_deload.low == 10.0
    assert without is not None
    assert (without.mean, without.low, without.high, without.weeks) == (45.0, 40.0, 50.0, 2)


# --- compute.run end to end: forecast_log, naive baseline, cycling, bands -----------------------


def run_compute(db: InMemoryPostgrest, workbook: bytes, today: date) -> compute.ComputeSummary:
    collect_strength.run(GOOGLE, bodyweight=SYNTHETIC_BODYWEIGHT, send=drive(workbook), db=db)
    rides = [
        raw_ride("i1", "2026-02-19T07:00:00", load=60),
        raw_ride("i2", "2026-02-26T07:00:00", load=70),
        raw_ride("i3", "2026-03-05T07:00:00", load=80),
        raw_ride("i4", "2026-03-12T07:00:00", load=90),
        raw_ride("i5", "2026-03-14T07:00:00", load=40, kind="Ride"),
        raw_ride("g1", "2026-02-03T19:00:00", load=19, kind="WeightTraining"),
        raw_ride("g2", "2026-02-05T19:00:00", load=17, kind="WeightTraining"),
        raw_ride("g3", "2026-03-10T19:00:00", load=17, kind="WeightTraining"),
    ]
    parsed = parse_activities(rides)
    upsert_activities(db, parsed.cycling)
    upsert_strength_activities(db, parsed.strength)
    at = datetime.combine(today, datetime.min.time(), tzinfo=UTC) + timedelta(hours=3)
    return compute.run(db, strength_k=0.02, today=today, computed_at=at)


def floats(row: dict[str, object], *keys: str) -> list[float]:
    values = [row[k] for k in keys]
    assert all(isinstance(v, float) for v in values), (keys, values)
    return [v for v in values if isinstance(v, float)]


def test_compute_logs_112_rows_per_day_idempotently_and_keeps_earlier_days(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    """AC7 through compute.run, incl. the summary count."""
    assert run_compute(db, workbook_bytes, FIXED_TODAY).logged_forecast_rows == 112
    assert len(db.tables["forecast_log"]) == 2 * HORIZON_DAYS
    first_day = sorted(map(str, db.tables["forecast_log"]))
    run_compute(db, workbook_bytes, FIXED_TODAY)
    assert sorted(map(str, db.tables["forecast_log"])) == first_day
    run_compute(db, workbook_bytes, FIXED_TODAY + timedelta(days=1))
    rows = db.tables["forecast_log"]
    assert len(rows) == 4 * HORIZON_DAYS
    earlier = sorted(str(r) for r in rows if r["made_on"] == FIXED_TODAY.isoformat())
    assert earlier == first_day
    params = {str(r["params"]) for r in rows}
    assert params == {str({"model_version": "plan-v1", "strength_k": 0.02, "decay": "exponential"})}


def test_naive_log_rows_hold_the_28_day_mean_and_carry_no_method_or_band(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    """AC8 end to end, with strength AND cycling inside the window."""
    run_compute(db, workbook_bytes, FIXED_TODAY)
    first = FIXED_TODAY - timedelta(days=NAIVE_DAYS)
    window = [
        r for r in db.tables["daily_load"] if first.isoformat() <= str(r["date"]) < str(FIXED_TODAY)
    ]
    assert len(window) == NAIVE_DAYS
    mean = sum(sum(floats(r, "cycling_tss", "strength_tss")) for r in window) / NAIVE_DAYS
    assert any(floats(r, "strength_tss")[0] > 0 for r in window)
    naive = [r for r in db.tables["forecast_log"] if r["method"] == "naive"]
    assert len(naive) == HORIZON_DAYS
    for r in naive:
        assert sum(floats(r, "cycling_tss", "strength_tss")) == pytest.approx(mean)
        assert r["strength_method"] is None
        bands = ("ctl_low", "ctl_high", "atl_low", "atl_high", "tsb_low", "tsb_high")
        assert [r[k] for k in bands] == [None] * 6
    model = [r for r in db.tables["forecast_log"] if r["method"] == "model"]
    assert {r["strength_method"] for r in model} == {"plan", "recent"}


def test_compute_cycling_forecast_is_the_typical_week(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    """AC9 end to end: every forecast day's cycling = mean per weekday of the 28 days before."""
    run_compute(db, workbook_bytes, FIXED_TODAY)
    first = FIXED_TODAY - timedelta(days=28)
    per_weekday: dict[int, list[float]] = {}
    for r in db.tables["daily_load"]:
        day = date.fromisoformat(str(r["date"]))
        if first <= day < FIXED_TODAY:
            per_weekday.setdefault(day.weekday(), []).extend(floats(r, "cycling_tss"))
    for r in db.tables["daily_projection"]:
        weekday = date.fromisoformat(str(r["date"])).weekday()
        expected = sum(per_weekday[weekday]) / len(per_weekday[weekday])
        assert floats(r, "cycling_tss")[0] == pytest.approx(expected)
    thursdays = [r for r in db.tables["daily_projection"] if r["date"] == "2026-03-19"]
    assert floats(thursdays[0], "cycling_tss")[0] == pytest.approx((70 + 80 + 90 + 60) / 4)


def test_compute_block_ends_mid_horizon_and_bands_hold_after_it(
    db: InMemoryPostgrest, workbook_bytes: bytes
) -> None:
    """AC6 end to end: blok 12 test's last prescribed week starts 16 Mar, so 16-22 Mar (Sunday)
    is "plan" with null bands and 23 Mar on is "recent" with low <= value <= high. Blok 11's
    only done week is its deload week, so the recent average has nothing to use: a reason."""
    run_compute(db, workbook_bytes, FIXED_TODAY)
    rows = sorted(db.tables["daily_projection"], key=lambda r: str(r["date"]))
    assert len(rows) == HORIZON_DAYS
    for r in rows:
        inside = str(r["date"]) <= "2026-03-22"
        assert r["strength_method"] == ("plan" if inside else "recent"), r["date"]
        for metric in ("ctl", "atl", "tsb"):
            low, high = r[f"{metric}_low"], r[f"{metric}_high"]
            if inside:
                assert (low, high) == (None, None)
            else:
                value, lo, hi = floats(r, metric, f"{metric}_low", f"{metric}_high")
                assert lo - 1e-9 <= value <= hi + 1e-9
    after = [e for r in rows if str(r["date"]) > "2026-03-22" for e in strength_entries(r)]
    assert after, "sessions are still placed after the block"
    assert all(e["tss"] is None and e["reason"] == "no recent weeks to average" for e in after)
    plan_entries = [e for r in rows if str(r["date"]) <= "2026-03-22" for e in strength_entries(r)]
    assert plan_entries and all(e["method"] == "plan" for e in plan_entries)
    assert any(r["name"] == BLOK_12 and r["deload_start"] is None for r in db.tables["blocks"])


def strength_entries(row: dict[str, object]) -> list[dict[str, object]]:
    basis = row["basis"]
    assert isinstance(basis, dict)
    value = basis["strength"]
    assert isinstance(value, list)
    return [e for e in value if isinstance(e, dict)]


def test_naive_projection_with_no_history_in_the_window_is_empty_not_zero() -> None:
    """Edge: the first day of the series (no days before today) has no baseline, never a 0."""
    days = history(date(2026, 1, 1))
    assert naive_projection(days, today=date(2026, 1, 1), decay=Decay.EXPONENTIAL) == []
