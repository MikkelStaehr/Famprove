import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { readVideoClips, recordClip, recordClipAuto, recordClipRange, recordClipTrim, recordStar, removeClip, type VideoClipOptions } from "../src/lib/db/video-clips.ts";
import { parseTrimClipInput } from "../src/lib/video/trim.ts";
import { FIXTURE_FAILING_RANGE_ID } from "../src/lib/video/clip-range.ts";
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
  lastPatch?: URLSearchParams;
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
    if (op === "gte" && !(Number(row[column]) >= Number(rest.join(".")))) return false;
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
        if (!rows.some((r) => r.id === body.id)) rows.push({ starred: false, clip_in_s: null, clip_out_s: null, auto_in_s: null, auto_out_s: null, auto_status: null, auto_run_ms: null, recorded_at: NOW.toISOString(), ...body });
        response = new Response(null, { status: 201 });
      } else if (method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Row; // the test's own request body
        const keys = Object.keys(body).join(",");
        assert.ok(
          keys === "starred" || keys === "clip_in_s,clip_out_s" || keys === "auto_in_s,auto_out_s,auto_status,auto_run_ms" ||
            keys === "duration_s,clip_in_s,clip_out_s,auto_in_s,auto_out_s,auto_status,auto_run_ms",
          `only starred, the range, the auto clip or a trim is updated (${keys})`,
        );
        db.lastPatch = parsed.searchParams;
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
  assert.deepEqual(Object.keys(row).toSorted(), ["auto_in_s", "auto_out_s", "auto_run_ms", "auto_status", "clip_in_s", "clip_out_s", "date", "duration_s", "exercise_id", "id", "recorded_at", "row_no", "session_no", "set_no", "starred", "variant_id"], "metadata only");
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

test("delete: refused on a preview host, nothing sent", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db));
  const before = db.requests;
  assert.deepEqual(await removeClip({ id: ID }, opts(db, { VERCEL_ENV: "preview" })), { ok: false, reason: "not_allowed" });
  assert.equal(db.requests, before);
  assert.equal(db.tables.video_clips.length, 1);
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
  db.tables.video_clips.push({ id: ID, date: "2026-10-17", session_no: 2, row_no: 30, set_no: 1, exercise_id: 11, variant_id: null, recorded_at: "2026-10-17T07:00:00+00:00", duration_s: 12.5, starred: true, clip_in_s: null, clip_out_s: null, auto_in_s: 1.5, auto_out_s: 9.0, auto_status: "clipped" });
  const rows = await readVideoClips(NOW, opts(db));
  assert.equal(db.lastGet?.get("or"), "(date.gte.2026-08-22,starred.is.true)");
  assert.deepEqual(rows, [{ id: ID, date: "2026-10-17", session: 2, row: 30, set: 1, exerciseId: 11, variantId: null, recordedAt: "2026-10-17T07:00:00+00:00", durationS: 12.5, starred: true, clipInS: null, clipOutS: null, autoInS: 1.5, autoOutS: 9, autoStatus: "clipped" }]);
  db.tables.video_clips[0].set_no = 0;
  await assert.rejects(readVideoClips(NOW, opts(db)), /set_no/);
  assert.deepEqual(await readVideoClips(NOW, opts(fakeDb(), { DEV_FIXTURE: "empty" }, "development")), []);
});

// --- clip-handles: setClipRange ---------------------------------------------------------------

test("range: one read + one PATCH, rounded to 0.1, idempotent (AC 9, 10)", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db)); // duration_s 14.3
  const before = db.requests;
  const want = { ok: true, dev: false, inS: 2.3, outS: 9.1 };
  assert.deepEqual(await recordClipRange({ id: ID, inS: 2.34, outS: 9.06 }, opts(db)), want);
  assert.equal(db.requests - before, 2, "one read of duration_s, one PATCH");
  assert.deepEqual(await recordClipRange({ id: ID, inS: 2.34, outS: 9.06 }, opts(db)), want, "the same values twice: two OK replies");
  assert.equal(db.tables.video_clips.length, 1);
  assert.deepEqual([db.tables.video_clips[0].clip_in_s, db.tables.video_clips[0].clip_out_s], [2.3, 9.1]);
  assert.deepEqual(await recordClipRange({ id: ID, inS: null, outS: null }, opts(db)), { ok: true, dev: false, inS: null, outS: null });
  assert.deepEqual([db.tables.video_clips[0].clip_in_s, db.tables.video_clips[0].clip_out_s], [null, null]);
});

test("range: refusals write nothing (AC 9)", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db)); // duration_s 14.3
  const writes = db.writes;
  for (const [inS, outS] of [[5, 5], [6, 5], [5, 5.9], [-0.1, 4], [2, 14.4], [null, 4], [2, null], [Number.NaN, 4], [2, Number.POSITIVE_INFINITY], ["2", 4]] as const) {
    assert.deepEqual(await recordClipRange({ id: ID, inS, outS }, opts(db)), { ok: false, reason: "range" }, `${String(inS)}/${String(outS)}`);
  }
  assert.equal(db.writes, writes);
  assert.deepEqual(await recordClipRange({ id: ID, inS: 0, outS: 14.3 }, opts(db)), { ok: true, dev: false, inS: 0, outS: 14.3 }, "the whole clip is a range");
});

test("range: an unknown id is not_found; a preview host and a failed request are refused", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordClipRange({ id: ID, inS: 1, outS: 3 }, opts(db)), { ok: false, reason: "not_found" });
  assert.equal(db.writes, 0);
  assert.deepEqual(await recordClipRange({ id: ID, inS: 1, outS: 3 }, opts(db, { VERCEL_ENV: "preview" })), { ok: false, reason: "not_allowed" });
  await recordClip(input(), NOW, opts(db));
  db.cut = { at: db.requests + 2, afterApply: false };
  assert.deepEqual(await recordClipRange({ id: ID, inS: 1, outS: 3 }, opts(db)), { ok: false, reason: "failed" });
});

test("range: dev switches reach no Supabase request; the clips fixture's failing clip fails (AC 11)", async () => {
  const db = fakeDb();
  const today = opts(db, { DEV_TODAY: "2026-10-19" }, "development");
  assert.deepEqual(await recordClipRange({ id: ID, inS: 1.04, outS: 3 }, today), { ok: true, dev: true, inS: 1, outS: 3 });
  const clips = opts(db, { DEV_FIXTURE: "clips" }, "development");
  assert.deepEqual(await recordClipRange({ id: ID, inS: 1, outS: 3 }, clips), { ok: true, dev: true, inS: 1, outS: 3 });
  assert.deepEqual(await recordClipRange({ id: FIXTURE_FAILING_RANGE_ID, inS: 1, outS: 3 }, clips), { ok: false, reason: "failed" });
  assert.deepEqual(await recordClipRange({ id: ID, inS: 3, outS: 1 }, clips), { ok: false, reason: "range" });
  assert.equal(db.requests, 0);
});

// --- clip-auto: setClipAuto -------------------------------------------------------------------

const auto = (over: Record<string, unknown> = {}) => ({ id: ID, status: "clipped", inS: 2.34, outS: 9.06, runMs: 4100, ...over });

test("auto: one read + one PATCH of the four auto columns, rounded to 0.1, idempotent", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db)); // duration_s 14.3
  const before = db.requests;
  const want = { ok: true, dev: false, status: "clipped", inS: 2.3, outS: 9.1, runMs: 4100 };
  assert.deepEqual(await recordClipAuto(auto(), opts(db)), want);
  assert.equal(db.requests - before, 2, "one read of duration_s, one PATCH");
  assert.deepEqual(await recordClipAuto(auto(), opts(db)), want, "the same values twice: two OK replies");
  const row = () => db.tables.video_clips[0];
  assert.equal(db.tables.video_clips.length, 1);
  assert.deepEqual([row().auto_in_s, row().auto_out_s, row().auto_status, row().auto_run_ms], [2.3, 9.1, "clipped", 4100]);
  assert.deepEqual([row().clip_in_s, row().clip_out_s, row().starred], [null, null, false], "the user's range and star are untouched");
  assert.deepEqual(await recordClipAuto(auto({ status: "low_confidence", inS: null, outS: null, runMs: 900 }), opts(db)), {
    ok: true,
    dev: false,
    status: "low_confidence",
    inS: null,
    outS: null,
    runMs: 900,
  });
  assert.deepEqual([row().auto_in_s, row().auto_out_s, row().auto_status, row().auto_run_ms], [null, null, "low_confidence", 900]);
});

test("auto: refusals write nothing", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db)); // duration_s 14.3
  const writes = db.writes;
  for (const over of [
    { outS: 14.4 }, // past duration_s, read server-side
    { inS: 5, outS: 5 },
    { inS: -0.1 },
    { inS: null, outS: null },
    { status: "failed" }, // in/out must be null unless clipped
    { status: "maybe", inS: null, outS: null },
    { runMs: 3_600_001 },
    { runMs: 2.5 },
  ]) {
    assert.deepEqual(await recordClipAuto(auto(over), opts(db)), { ok: false, reason: "range" }, JSON.stringify(over));
  }
  assert.equal(db.writes, writes);
  assert.deepEqual(await recordClipAuto(auto({ inS: 0, outS: 14.3 }), opts(db)), { ok: true, dev: false, status: "clipped", inS: 0, outS: 14.3, runMs: 4100 });
});

test("auto: an unknown id is not_found; a preview host and a failed request are refused", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordClipAuto(auto(), opts(db)), { ok: false, reason: "not_found" });
  assert.equal(db.writes, 0);
  assert.deepEqual(await recordClipAuto(auto(), opts(db, { VERCEL_ENV: "preview" })), { ok: false, reason: "not_allowed" });
  await recordClip(input(), NOW, opts(db));
  const writes = db.writes;
  assert.deepEqual(await recordClipAuto(auto(), opts(db, { VERCEL_ENV: "preview" })), { ok: false, reason: "not_allowed" });
  assert.equal(db.writes, writes, "a preview writes nothing");
  db.cut = { at: db.requests + 2, afterApply: false };
  assert.deepEqual(await recordClipAuto(auto(), opts(db)), { ok: false, reason: "failed" });
  assert.equal(db.tables.video_clips[0].auto_status, null);
  assert.deepEqual(await recordClipAuto(auto(), opts(db)), { ok: true, dev: false, status: "clipped", inS: 2.3, outS: 9.1, runMs: 4100 }, "a retry lands");
});

test("auto: dev switches reach no Supabase request", async () => {
  const db = fakeDb();
  const today = opts(db, { DEV_TODAY: "2026-10-19" }, "development");
  assert.deepEqual(await recordClipAuto(auto(), today), { ok: true, dev: true, status: "clipped", inS: 2.3, outS: 9.1, runMs: 4100 });
  const clips = opts(db, { DEV_FIXTURE: "clips" }, "development");
  assert.deepEqual(await recordClipAuto(auto({ status: "failed", inS: null, outS: null }), clips), { ok: true, dev: true, status: "failed", inS: null, outS: null, runMs: 4100 });
  assert.deepEqual(await recordClipAuto(auto({ inS: 3, outS: 1 }), clips), { ok: false, reason: "range" });
  assert.equal(db.requests, 0);
});

// --- trim (slice clip-trim) ------------------------------------------------------------------------

test("trim: the validation table; the one PATCH clears the ranges and auto_*; the same duration again is ok", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db)); // duration_s 14.3
  const row = db.tables.video_clips[0];
  Object.assign(row, { clip_in_s: 2, clip_out_s: 9, auto_in_s: 1, auto_out_s: 8, auto_status: "clipped", auto_run_ms: 900 });
  const writes = db.writes;
  const table: Array<[unknown, string]> = [
    [0, "duration"], [-1, "duration"], [Number.NaN, "duration"], [Number.POSITIVE_INFINITY, "duration"], ["7", "duration"],
    [null, "duration"], [901, "duration"], [14.4, "duration"], [20, "duration"], [0.04, "duration"],
  ];
  for (const [d, reason] of table) {
    assert.deepEqual(await recordClipTrim({ id: ID, durationS: d }, opts(db)), { ok: false, reason }, String(d));
  }
  assert.equal(db.writes, writes, "a refused trim writes nothing");
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 7.26 }, opts(db)), { ok: true, dev: false, durationS: 7.3 });
  assert.equal(db.writes, writes + 1, "one PATCH");
  assert.deepEqual(
    { d: row.duration_s, ci: row.clip_in_s, co: row.clip_out_s, ai: row.auto_in_s, ao: row.auto_out_s, as: row.auto_status, ar: row.auto_run_ms },
    { d: 7.3, ci: null, co: null, ai: null, ao: null, as: null, ar: null },
  );
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 7.3 }, opts(db)), { ok: true, dev: false, durationS: 7.3 }, "idempotent: a retry after a lost reply");
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 9 }, opts(db)), { ok: false, reason: "duration" }, "never longer than the stored duration");
});

test("trim: the PATCH filters duration_s=gte.<new>, so a row shortened after the read is never raised (0 rows = duration)", async () => {
  const db = fakeDb();
  await recordClip(input(), NOW, opts(db)); // duration_s 14.3
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 7.3 }, opts(db)), { ok: true, dev: false, durationS: 7.3 });
  assert.equal(db.lastPatch?.get("duration_s"), "gte.7.3");
  assert.equal(db.lastPatch?.get("id"), `eq.${ID}`);
  const row = db.tables.video_clips[0];
  const base = opts(db);
  const racing: VideoClipOptions = {
    ...base,
    client: () =>
      createClient("https://x.supabase.co", "sb_secret_test", async (url, init) => {
        const r = await fetchFor(db)(url, init);
        if ((init.method ?? "GET") === "GET") row.duration_s = 5; // another tab's shorter cut lands between the read and the PATCH
        return r;
      }),
  };
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 6 }, racing), { ok: false, reason: "duration" });
  assert.equal(row.duration_s, 5, "never raised");
});

test("trim: not_found, preview host, dev switches and a failed request", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 5 }, opts(db)), { ok: false, reason: "not_found" });
  assert.equal(db.writes, 0);
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 5 }, opts(db, { VERCEL_ENV: "preview" })), { ok: false, reason: "not_allowed" });
  const before = db.requests;
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 5 }, opts(db, { DEV_FIXTURE: "clips" }, "development")), { ok: true, dev: true, durationS: 5 });
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 5 }, opts(db, { DEV_TODAY: "2026-10-19" }, "development")), { ok: true, dev: true, durationS: 5 });
  assert.equal(db.requests, before, "dev switches reach no Supabase request");
  await recordClip(input(), NOW, opts(db));
  db.cut = { at: db.requests + 2, afterApply: false };
  assert.deepEqual(await recordClipTrim({ id: ID, durationS: 5 }, opts(db)), { ok: false, reason: "failed" });
  assert.equal(db.tables.video_clips[0].duration_s, 14.3);
});

test("trim: the action's input parse", () => {
  assert.deepEqual(parseTrimClipInput({ id: ID, durationS: 5 }), { id: ID, durationS: 5 });
  for (const raw of [null, [], "x", { id: "nope", durationS: 5 }, { id: ID }]) assert.equal(parseTrimClipInput(raw), null, JSON.stringify(raw));
});
