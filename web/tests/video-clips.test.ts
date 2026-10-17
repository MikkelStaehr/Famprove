import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { readVideoClips, recordClip, recordStar, removeClip, type VideoClipOptions } from "../src/lib/db/video-clips.ts";
import {
  clipDateAge,
  parseDeleteClipInput,
  parseSaveClipInput,
  parseStarClipInput,
  PERMANENT_SAVE_REFUSALS,
  recordingAllowed,
  type SaveClipInput,
} from "../src/lib/video/clips.ts";

// --- fake PostgREST ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type FakeDb = {
  tables: Record<string, Row[]>;
  requests: number;
  writes: number;
  /** Fail this request number with a 503 before it applies ("cut"), or after it applied ("lost reply"). */
  cut?: { at: number; afterApply: boolean };
  lastGet?: URLSearchParams;
};

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const NOW = new Date("2026-10-17T08:00:00.000Z"); // Saturday; ISO week starts 2026-10-12

function fakeDb(): FakeDb {
  return {
    tables: {
      strength_sets: [
        { week_start: "2026-10-12", session: 2, sheet_row: 30, set_no: 1, name: "Squat", reps_text: "5", variant_id: 4 },
        { week_start: "2026-10-12", session: 2, sheet_row: 30, set_no: 2, name: "Squat", reps_text: "5", variant_id: 4 },
        { week_start: "2026-10-12", session: 2, sheet_row: 31, set_no: 1, name: "Mystery lift", reps_text: "8", variant_id: null },
      ],
      exercises: [{ id: 11, name: "Squat", aliases: ["back squat"] }],
      video_clips: [],
    },
    requests: 0,
    writes: 0,
  };
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    if (op === "eq" && String(row[column]) !== rest.join(".")) return false;
  }
  return true;
}

function fetchFor(db: FakeDb): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    const method = init.method ?? "GET";
    db.requests += 1;
    const cut = db.cut !== undefined && db.cut.at === db.requests ? db.cut : undefined;
    if (cut !== undefined && !cut.afterApply) return new Response("{}", { status: 503 });
    const rows = db.tables[table];
    const prefer = new Headers(init.headers).get("Prefer") ?? "";
    let response: Response;
    if (method === "GET") {
      db.lastGet = parsed.searchParams;
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      response = new Response(JSON.stringify(found), { headers: { "Content-Range": found.length ? `0-${found.length - 1}/${found.length}` : "*/0" } });
    } else {
      assert.equal(table, "video_clips");
      db.writes += 1;
      if (method === "POST") {
        assert.equal(parsed.searchParams.get("on_conflict"), "id");
        assert.match(prefer, /resolution=ignore-duplicates/);
        const body = JSON.parse(String(init.body)) as Row; // the test's own request body
        assert.equal(body.recorded_at, undefined, "recorded_at is the column default");
        if (!rows.some((r) => r.id === body.id)) rows.push({ starred: false, clip_in_s: null, clip_out_s: null, recorded_at: NOW.toISOString(), ...body });
        response = new Response(null, { status: 201 });
      } else if (method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Row; // the test's own request body
        assert.deepEqual(Object.keys(body), ["starred"], "only starred is updated");
        const hit = rows.filter((r) => matches(r, parsed.searchParams));
        for (const r of hit) Object.assign(r, body);
        response = new Response(JSON.stringify(hit.map((r) => ({ id: r.id }))), { status: 200 });
      } else {
        assert.equal(method, "DELETE");
        db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
        response = new Response(null, { status: 204 });
      }
    }
    return cut !== undefined ? new Response("{}", { status: 503 }) : response;
  };
}

const opts = (db: FakeDb, env: Record<string, string> = { VERCEL_ENV: "production" }, nodeEnv = "production"): VideoClipOptions => ({
  env,
  nodeEnv,
  client: () => createClient("https://x.supabase.co", "sb_secret_test", fetchFor(db)),
});

const input = (over: Partial<SaveClipInput> = {}): SaveClipInput => ({ id: ID, date: "2026-10-17", sessionNo: 2, row: 30, set: 2, durationS: 14.26, ...over });

test("parse: strict shape, uuid format and bounds", () => {
  const ok = { id: ID, date: "2026-10-17", sessionNo: 2, row: 30, set: 1, durationS: 12.5 };
  assert.deepEqual(parseSaveClipInput(ok), ok);
  assert.equal(parseSaveClipInput({ ...ok, set: 0 })?.set, 0, "set 0 parses; the action refuses it as a warm-up");
  for (const bad of [
    null,
    [],
    "x",
    { ...ok, id: ID.toUpperCase() },
    { ...ok, id: "not-a-uuid" },
    { ...ok, id: `${ID}0` },
    { ...ok, date: "2026-02-30" },
    { ...ok, date: "17-10-2026" },
    { ...ok, sessionNo: 0 },
    { ...ok, row: 1.5 },
    { ...ok, set: -1 },
    { ...ok, set: "1" },
    { ...ok, durationS: "12" },
    { ...ok, durationS: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(parseSaveClipInput(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseStarClipInput({ id: ID, starred: true }), { id: ID, starred: true });
  assert.equal(parseStarClipInput({ id: ID, starred: 1 }), null);
  assert.deepEqual(parseDeleteClipInput({ id: ID }), { id: ID });
  assert.equal(parseDeleteClipInput({ id: "1" }), null);
});

test("save: one row with the sheet's exercise and variant, the duration as numeric(6,1)", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordClip(input(), NOW, opts(db)), { ok: true, dev: false, id: ID });
  assert.equal(db.writes, 1);
  const [row] = db.tables.video_clips;
  assert.deepEqual(
    { id: row.id, date: row.date, session_no: row.session_no, row_no: row.row_no, set_no: row.set_no, exercise_id: row.exercise_id, variant_id: row.variant_id, duration_s: row.duration_s },
    { id: ID, date: "2026-10-17", session_no: 2, row_no: 30, set_no: 2, exercise_id: 11, variant_id: 4, duration_s: 14.3 },
  );
  assert.deepEqual(Object.keys(row).toSorted(), ["clip_in_s", "clip_out_s", "date", "duration_s", "exercise_id", "id", "recorded_at", "row_no", "session_no", "set_no", "starred", "variant_id"], "metadata only");
});

test("save: refusals write nothing", async () => {
  const cases: [SaveClipInput, string, Record<string, string>?, string?][] = [
    [input({ date: "2026-10-18" }), "future"],
    [input({ date: "2026-08-21" }), "too_old"], // 57 days before 2026-10-17
    [input({ date: "2026-08-22" }), "no_set"], // 56 days: inside the keep, so the sheet is read (no set that week)
    [input({ set: 0 }), "warmup"],
    [input({ set: 3 }), "no_set"],
    [input({ row: 99 }), "no_set"],
    [input({ sessionNo: 3 }), "no_set"],
    [input({ row: 31, set: 1 }), "no_exercise"],
    [input({ durationS: 0.04 }), "duration"],
    [input({ durationS: 900.06 }), "duration"],
    [input(), "not_allowed", { VERCEL_ENV: "preview" }],
    [input(), "not_allowed", {}, "production"],
  ];
  for (const [i, reason, env, nodeEnv] of cases) {
    const db = fakeDb();
    assert.deepEqual(await recordClip(i, NOW, opts(db, env, nodeEnv)), { ok: false, reason }, reason);
    assert.equal(db.writes, 0, reason);
  }
  const db = fakeDb();
  assert.equal((await recordClip(input({ durationS: 900.04 }), NOW, opts(db))).ok, true, "900.04 rounds to 900.0");
});

test("save: an earlier day inside the keep is saved with its own date and week (a retried insert)", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordClip(input({ date: "2026-10-16" }), NOW, opts(db)), { ok: true, dev: false, id: ID });
  assert.equal(db.tables.video_clips[0].date, "2026-10-16");
  assert.equal(db.tables.video_clips[0].exercise_id, 11);
});

test("save: the date window and the permanent refusals", () => {
  assert.equal(clipDateAge("2026-10-17", "2026-10-17"), null);
  assert.equal(clipDateAge("2026-10-16", "2026-10-17"), null);
  assert.equal(clipDateAge("2026-08-22", "2026-10-17"), null);
  assert.equal(clipDateAge("2026-08-21", "2026-10-17"), "too_old");
  assert.equal(clipDateAge("2026-10-18", "2026-10-17"), "future");
  for (const r of ["too_old", "warmup", "no_set", "no_exercise", "duration", "invalid"] as const) assert.ok(PERMANENT_SAVE_REFUSALS.has(r), r);
  for (const r of ["not_allowed", "failed", "future"] as const) assert.ok(!PERMANENT_SAVE_REFUSALS.has(r), r);
});

test("recording is allowed on production and in next dev, never on a preview", () => {
  assert.equal(recordingAllowed({ VERCEL_ENV: "production" }, "production"), true);
  assert.equal(recordingAllowed({}, "development"), true);
  assert.equal(recordingAllowed({ VERCEL_ENV: "preview" }, "production"), false);
  assert.equal(recordingAllowed({}, "production"), false);
});

test("save twice gives one row; the first insert's values stand", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db));
  assert.equal((await recordClip(input({ durationS: 20 }), NOW, opts(db))).ok, true);
  assert.equal(db.tables.video_clips.length, 1);
  assert.equal(db.tables.video_clips[0].duration_s, 14.3);
});

test("a cut at every request, then a retry: one row", async () => {
  for (const afterApply of [false, true]) {
    for (let at = 1; at <= 3; at += 1) {
      const db = fakeDb();
      db.cut = { at, afterApply };
      assert.deepEqual(await recordClip(input(), NOW, opts(db)), { ok: false, reason: "failed" }, `cut at ${at}`);
      db.cut = undefined;
      assert.equal((await recordClip(input(), NOW, opts(db))).ok, true);
      assert.equal(db.tables.video_clips.length, 1, `cut at ${at}, afterApply ${afterApply}`);
    }
  }
});

test("star: one PATCH, idempotent; found false before the row exists", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordStar({ id: ID, starred: true }, opts(db)), { ok: true, dev: false, found: false });
  await recordClip(input(), NOW, opts(db));
  const before = db.requests;
  assert.deepEqual(await recordStar({ id: ID, starred: true }, opts(db)), { ok: true, dev: false, found: true });
  assert.equal(db.requests - before, 1, "one request");
  assert.deepEqual(await recordStar({ id: ID, starred: true }, opts(db)), { ok: true, dev: false, found: true });
  assert.equal(db.tables.video_clips[0].starred, true);
  db.cut = { at: db.requests + 1, afterApply: false };
  assert.deepEqual(await recordStar({ id: ID, starred: false }, opts(db)), { ok: false, reason: "failed" });
});

test("delete: one DELETE, idempotent", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db));
  assert.deepEqual(await removeClip({ id: ID }, opts(db)), { ok: true, dev: false });
  assert.deepEqual(await removeClip({ id: ID }, opts(db)), { ok: true, dev: false });
  assert.equal(db.tables.video_clips.length, 0);
});

test("dev switches write nothing", async () => {
  const db = fakeDb();
  const dev = opts(db, { DEV_TODAY: "2026-10-01" }, "development");
  assert.deepEqual(await recordClip(input({ date: "2026-10-01" }), NOW, dev), { ok: true, dev: true, id: ID });
  assert.deepEqual(await recordStar({ id: ID, starred: true }, dev), { ok: true, dev: true, found: true });
  assert.deepEqual(await removeClip({ id: ID }, dev), { ok: true, dev: true });
  assert.equal(db.requests, 0);
});

test("read: the last 8 weeks plus every starred row, parsed", async () => {
  const db = fakeDb();
  db.tables.video_clips.push({ id: ID, date: "2026-10-17", session_no: 2, row_no: 30, set_no: 1, exercise_id: 11, variant_id: null, recorded_at: "2026-10-17T07:00:00+00:00", duration_s: 12.5, starred: true, clip_in_s: null, clip_out_s: null });
  const rows = await readVideoClips(NOW, opts(db));
  assert.equal(db.lastGet?.get("or"), "(date.gte.2026-08-22,starred.is.true)");
  assert.deepEqual(rows, [{ id: ID, date: "2026-10-17", session: 2, row: 30, set: 1, exerciseId: 11, variantId: null, recordedAt: "2026-10-17T07:00:00+00:00", durationS: 12.5, starred: true, clipInS: null, clipOutS: null }]);
  db.tables.video_clips[0].set_no = 0;
  await assert.rejects(readVideoClips(NOW, opts(db)), /set_no/);
  assert.deepEqual(await readVideoClips(NOW, opts(fakeDb(), { DEV_FIXTURE: "empty" }, "development")), []);
});
