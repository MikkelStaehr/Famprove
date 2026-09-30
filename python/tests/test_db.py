"""db.client against a fake HttpSend; table modules against the in-memory PostgREST."""

from collections.abc import Callable
from datetime import UTC, date, datetime

import pytest

from conftest import Call, FakeResponse, FakeSend, InMemoryPostgrest
from training_load.db import (
    activities,
    blocks,
    daily_load,
    strength_activities,
    strength_sessions,
    strength_sets,
)
from training_load.db.client import EmptyFilterError, Postgrest, auth_headers
from training_load.db.strength_sets import EmptyReplaceError
from training_load.domain.cycling import CyclingActivity
from training_load.domain.daily import build_daily_load
from training_load.domain.sessions import StrengthActivity, StrengthSession
from training_load.domain.strength import Block, StrengthSet

MakeSet = Callable[..., StrengthSet]


def test_auth_headers_legacy_jwt_sends_apikey_and_bearer() -> None:
    assert auth_headers("eyJhbGciOi.x.y") == {
        "apikey": "eyJhbGciOi.x.y",
        "Authorization": "Bearer eyJhbGciOi.x.y",
    }


def test_auth_headers_sb_secret_sends_apikey_only() -> None:
    assert auth_headers("sb_secret_abc") == {"apikey": "sb_secret_abc"}


def paged_handler(total: int, cap: int) -> Callable[[Call], FakeResponse]:
    """Serves rows 0..total-1, but never more than ``cap`` per response (server max_rows)."""

    def handler(call: Call) -> FakeResponse:
        params = dict(call.params or [])
        offset, limit = int(params["offset"]), min(int(params["limit"]), cap)
        page = [{"id": i} for i in range(offset, min(offset + limit, total))]
        last = offset + len(page) - 1
        return FakeResponse(body=page, headers={"Content-Range": f"{offset}-{last}/{total}"})

    return handler


@pytest.mark.parametrize(("total", "cap"), [(0, 1000), (2500, 1000), (2500, 300)])
def test_select_paginates_until_content_range_total(total: int, cap: int) -> None:
    send = FakeSend(handler=paged_handler(total, cap))
    rows = Postgrest("https://x.supabase.co/", "sb_secret_k", send).select(
        "t", columns="id", order="id"
    )
    assert [r["id"] for r in rows] == list(range(total))
    assert send.calls[0].url == "https://x.supabase.co/rest/v1/t"
    assert send.calls[0].headers["Prefer"] == "count=exact"


def test_insert_and_upsert_chunk_rows() -> None:
    send = FakeSend(handler=lambda _: FakeResponse(201))
    pg = Postgrest("https://x.supabase.co", "sb_secret_k", send)
    pg.upsert("t", [{"id": i} for i in range(1200)], on_conflict="id")
    assert [len(c.json) for c in send.calls if isinstance(c.json, list)] == [500, 500, 200]
    assert send.calls[0].params == [("on_conflict", "id")]
    assert send.calls[0].headers["Prefer"] == "resolution=merge-duplicates,return=minimal"


def test_delete_refuses_empty_filters() -> None:
    with pytest.raises(EmptyFilterError):
        Postgrest("https://x.supabase.co", "k", FakeSend()).delete("t", [])


def test_replace_for_sheet_refuses_zero_sets(db: InMemoryPostgrest, make_set: MakeSet) -> None:
    strength_sets.replace_for_sheet(db, "s1", [make_set(sheet_id="s1")])
    with pytest.raises(EmptyReplaceError):
        strength_sets.replace_for_sheet(db, "s1", [])
    assert len(db.tables["strength_sets"]) == 1


def test_replace_for_sheet_replaces_only_that_sheet(
    db: InMemoryPostgrest, make_set: MakeSet
) -> None:
    strength_sets.replace_for_sheet(db, "s1", [make_set(sheet_id="s1", set_no=n) for n in (1, 2)])
    strength_sets.replace_for_sheet(db, "s2", [make_set(sheet_id="s2")])
    strength_sets.replace_for_sheet(db, "s1", [make_set(sheet_id="s1", set_no=3)])
    assert sorted((s.sheet_id, s.set_no) for s in strength_sets.all_sets(db)) == [
        ("s1", 3),
        ("s2", 1),
    ]


def test_sync_blocks_prunes_stale_keys(db: InMemoryPostgrest) -> None:
    a = Block("s", "Program - blok 11", 11, date(2026, 2, 2), None, None)
    b = Block("s", "Program - blok 12, (v2)", 12, date(2026, 3, 9), None, None)
    blocks.sync_blocks(db, [a, b])
    blocks.sync_blocks(db, [a])
    assert blocks.stored_keys(db) == {("s", "Program - blok 11")}


def test_sync_daily_load_deletes_outside_range_and_rejects_gaps(db: InMemoryPostgrest) -> None:
    db.tables["daily_load"] = [{"date": "2025-12-31"}, {"date": "2026-01-09"}]
    days = build_daily_load({}, {}, start=date(2026, 1, 1), end=date(2026, 1, 3))
    run_at = datetime(2026, 1, 3, 3, 0, tzinfo=UTC)
    daily_load.sync_daily_load(
        db, days, start=date(2026, 1, 1), end=date(2026, 1, 3), computed_at=run_at
    )
    assert sorted(str(r["date"]) for r in db.tables["daily_load"]) == [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
    ]
    assert {r["computed_at"] for r in db.tables["daily_load"]} == {"2026-01-03T03:00:00+00:00"}
    assert {r["form_zone"] for r in db.tables["daily_load"]} == {"grey_zone"}
    with pytest.raises(ValueError, match="one row per day"):
        daily_load.sync_daily_load(
            db, days[:2], start=date(2026, 1, 1), end=date(2026, 1, 3), computed_at=run_at
        )
    with pytest.raises(ValueError, match="timezone-aware"):
        daily_load.sync_daily_load(
            db, days, start=date(2026, 1, 1), end=date(2026, 1, 3), computed_at=datetime(2026, 1, 3)
        )


def test_row_round_trip_activity_and_strength_set(make_set: MakeSet) -> None:
    ride = CyclingActivity(
        "i1", datetime(2026, 3, 1, 7, 5), "Ride", None, 80, 250, 85.3, 290, 3600, 3700, 80, None
    )
    assert activities.from_row(dict(activities.to_row(ride))) == ride
    s = make_set(rpe=None, prescribed="RPE 7 - 8")
    assert strength_sets.from_row(dict(strength_sets.to_row(s))) == s


def test_from_row_rejects_mistyped_column(make_set: MakeSet) -> None:
    row = dict(strength_sets.to_row(make_set()))
    row["bodyweight"] = "yes"
    with pytest.raises(ValueError, match="bodyweight"):
        strength_sets.from_row(row)


def test_strength_activity_round_trip_and_window_delete(db: InMemoryPostgrest) -> None:
    lift = StrengthActivity(
        "i9", datetime(2026, 9, 29, 10, 35), "WeightTraining", "Styrke", 4368, 4400, 22, "fenix 6"
    )
    assert strength_activities.from_row(dict(strength_activities.to_row(lift))) == lift
    strength_activities.upsert_strength_activities(db, [lift, lift])
    assert strength_activities.all_strength_activities(db) == [lift]
    assert strength_activities.ids_between(db, date(2026, 9, 29), date(2026, 9, 29)) == {"i9"}
    strength_activities.delete_ids(db, {"i9"})
    assert db.tables["strength_activities"] == []
    assert db.tables["activities"] == []  # never touches the rides table


def test_sync_strength_sessions_upserts_and_prunes(db: InMemoryPostgrest) -> None:
    week = date(2026, 9, 28)
    done = StrengthSession(
        week, 1, "s", "Program - blok 12", 1, "i1", date(2026, 9, 29), "Styrke", 4368, 50.0
    )
    planned = StrengthSession(week, 2, "s", "Program - blok 12", 1, None, None, None, None, 0.0)
    strength_sessions.sync_strength_sessions(db, [done, planned])
    # The activity is deleted upstream: session 1 loses its date, session 2 disappears.
    undone = StrengthSession(week, 1, "s", "Program - blok 12", 1, None, None, None, None, 0.0)
    strength_sessions.sync_strength_sessions(db, [undone])
    assert db.tables["strength_sessions"] == [dict(strength_sessions.to_row(undone))]
