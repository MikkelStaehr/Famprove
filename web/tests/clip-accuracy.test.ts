import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { recordClipTrim, type VideoClipOptions } from "../src/lib/db/video-clips.ts";
import { ALGO_VERSION } from "../src/lib/video/auto-clip.ts";
import { type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { memoryClipFiles } from "../src/lib/video/opfs.ts";
import {
  type CutResult,
  finishTrim,
  memoryLock,
  parseTrimClipInput,
  startTrim,
  TRIM_UNDO_MS,
  type TrimDeps,
  type TrimRequest,
  validateTrimPoints,
} from "../src/lib/video/trim.ts";

// Slice clip-accuracy-log: the destructive cut first inserts one public.clip_accuracy row, then patches the clip.

type Row = Record<string, unknown>;
type FakeDb = {
  clips: Row[];
  accuracy: Row[];
  requests: number;
  log: string[];
  /** Fail this request number with a 503 before it applies ("cut") or after it applied ("lost reply"). */
  cut?: { at: number; afterApply: boolean };
};

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

const clipRow = (over: Row = {}): Row => ({
  id: ID,
  date: "2026-10-22",
  session_no: 2,
  row_no: 30,
  set_no: 2,
  exercise_id: 11,
  variant_id: 4,
  recorded_at: "2026-10-22T08:00:00.000Z",
  duration_s: 14.3,
  starred: false,
  clip_in_s: null,
  clip_out_s: null,
  auto_in_s: 2.1,
  auto_out_s: 9.4,
  auto_status: "clipped",
  auto_run_ms: 4100,
  ...over,
});

const fakeDb = (over: Row = {}): FakeDb => ({ clips: [clipRow(over)], accuracy: [], requests: 0, log: [] });

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
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
    db.log.push(`${method} ${table}`);
    const cut = db.cut !== undefined && db.cut.at === db.requests ? db.cut : undefined;
    if (cut !== undefined && !cut.afterApply) return new Response("{}", { status: 503 });
    let response: Response;
    if (table === "clip_accuracy") {
      assert.equal(method, "POST", "clip_accuracy is insert-only");
      assert.equal(parsed.searchParams.get("on_conflict"), "clip_id");
      assert.match(new Headers(init.headers).get("Prefer") ?? "", /resolution=ignore-duplicates/);
      const body = JSON.parse(String(init.body)) as Row; // the test's own request body
      if (!db.accuracy.some((r) => r.clip_id === body.clip_id)) db.accuracy.push(body); // on conflict do nothing
      response = new Response(null, { status: 201 });
    } else {
      assert.equal(table, "video_clips");
      if (method === "GET") {
        const columns = (parsed.searchParams.get("select") ?? "").split(",");
        const found = db.clips.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
        response = new Response(JSON.stringify(found), { headers: { "Content-Range": found.length ? `0-${found.length - 1}/${found.length}` : "*/0" } });
      } else {
        assert.equal(method, "PATCH");
        const body = JSON.parse(String(init.body)) as Row; // the test's own request body
        const hit = db.clips.filter((r) => matches(r, parsed.searchParams));
        for (const r of hit) Object.assign(r, body);
        response = new Response(JSON.stringify(hit.map((r) => ({ id: r.id }))), { status: 200 });
      }
    }
    return cut !== undefined ? new Response("{}", { status: 503 }) : response;
  };
}

const opts = (db: FakeDb): VideoClipOptions => ({
  env: { VERCEL_ENV: "production" },
  nodeEnv: "production",
  client: () => createClient("https://x.supabase.co", "sb_secret_test", fetchFor(db)),
});

/** The action's path: the raw request parsed as trimClip does, then the data layer. */
async function trim(db: FakeDb, raw: TrimRequest) {
  const input = parseTrimClipInput(raw);
  assert.ok(input !== null, JSON.stringify(raw));
  return recordClipTrim(input, opts(db));
}

const OWN: TrimRequest = { id: ID, durationS: 7.3, inS: 1.04, outS: 8.96, kind: "own", algoVersion: ALGO_VERSION };

const ids = { clip_id: ID, date: "2026-10-22", session_no: 2, row_no: 30, set_no: 2, exercise_id: 11, variant_id: 4, duration_s: 14.3 };

test("accuracy: one insert, then the PATCH last", async () => {
  const db = fakeDb();
  assert.deepEqual(await trim(db, OWN), { ok: true, dev: false, durationS: 7.3 });
  assert.deepEqual(db.log, ["GET video_clips", "POST clip_accuracy", "PATCH video_clips"]);
  assert.equal(db.clips[0].duration_s, 7.3);
  assert.equal(db.clips[0].auto_in_s, null, "the PATCH still nulls auto_*");
});

test("accuracy: own with a clipped automatic range keeps both, rounded to 0.1, on the original's length", async () => {
  const db = fakeDb();
  await trim(db, OWN);
  assert.deepEqual(db.accuracy, [{ ...ids, kind: "own", auto_in_s: 2.1, auto_out_s: 9.4, user_in_s: 1, user_out_s: 9, algo_version: ALGO_VERSION }]);
});

test("accuracy: own without a clipped automatic range has no auto and no algo_version", async () => {
  for (const over of [
    { auto_in_s: null, auto_out_s: null, auto_status: null },
    { auto_in_s: null, auto_out_s: null, auto_status: "low_confidence" },
    { auto_in_s: null, auto_out_s: null, auto_status: "failed" },
  ]) {
    const db = fakeDb(over);
    assert.deepEqual(await trim(db, OWN), { ok: true, dev: false, durationS: 7.3 });
    assert.deepEqual(db.accuracy, [{ ...ids, kind: "own", auto_in_s: null, auto_out_s: null, user_in_s: 1, user_out_s: 9, algo_version: null }], String(over.auto_status));
  }
});

test("accuracy: approved records the automatic range with no user points; without one it records nothing", async () => {
  const db = fakeDb();
  await trim(db, { ...OWN, kind: "approved", inS: 2.1, outS: 9.4 });
  assert.deepEqual(db.accuracy, [{ ...ids, kind: "approved", auto_in_s: 2.1, auto_out_s: 9.4, user_in_s: null, user_out_s: null, algo_version: ALGO_VERSION }]);
  const none = fakeDb({ auto_in_s: null, auto_out_s: null, auto_status: "low_confidence" });
  assert.deepEqual(await trim(none, { ...OWN, kind: "approved" }), { ok: true, dev: false, durationS: 7.3 });
  assert.deepEqual(none.accuracy, []);
  assert.deepEqual(none.log, ["GET video_clips", "PATCH video_clips"]);
});

test("accuracy: the validation table (shape in the action's parse, range against the row's duration_s)", async () => {
  const base = { id: ID, durationS: 7.3, inS: 1, outS: 9, kind: "own" };
  for (const bad of [
    { ...base, inS: Number.NaN },
    { ...base, outS: Number.POSITIVE_INFINITY },
    { ...base, inS: "1" },
    { ...base, inS: undefined },
    { ...base, outS: null },
    { ...base, kind: "auto" },
    { ...base, kind: undefined },
    { ...base, algoVersion: 0 },
    { ...base, algoVersion: 1001 },
    { ...base, algoVersion: 2.5 },
    { ...base, algoVersion: "3" },
    { id: ID, durationS: 7.3, kind: "own" },
  ]) {
    assert.deepEqual(parseTrimClipInput(bad), { id: ID, durationS: 7.3, points: "unusable" }, `${JSON.stringify(bad)}: the cut stands, the record is skipped`);
  }
  assert.equal(parseTrimClipInput({ ...base, id: "x" }), null, "the trim's own fields stay invalid");
  assert.equal(parseTrimClipInput({ id: ID, inS: 1, outS: 9, kind: "own" }), null, "no duration: invalid");
  assert.deepEqual(parseTrimClipInput({ ...base, algoVersion: 1000 })?.points, { inS: 1, outS: 9, kind: "own", algoVersion: 1000 });
  assert.deepEqual(parseTrimClipInput(base)?.points, { inS: 1, outS: 9, kind: "own", algoVersion: null }, "no version sent = null");
  assert.deepEqual(parseTrimClipInput({ id: ID, durationS: 7.3 }), { id: ID, durationS: 7.3 }, "no points: an old pending cut");
  const range: Array<[number, number, { inS: number; outS: number } | null]> = [
    [0, 14.3, { inS: 0, outS: 14.3 }],
    [0.04, 14.34, { inS: 0, outS: 14.3 }],
    [1.05, 8.95, { inS: 1.1, outS: 9 }],
    [0, 14.36, null],
    [-0.1, 5, null],
    [5, 5, null],
    [5.01, 5.04, null],
    [6, 5, null],
  ];
  for (const [i, o, want] of range) assert.deepEqual(validateTrimPoints(i, o, 14.3), want, `${i}–${o}`);
  const db = fakeDb();
  assert.deepEqual(await trim(db, { ...OWN, outS: 15 }), { ok: true, dev: false, durationS: 7.3 }, "points past the original skip the record, not the cut");
  assert.deepEqual(db.log, ["GET video_clips", "PATCH video_clips"], "no insert, the PATCH lands");
  assert.deepEqual(db.accuracy, []);
  assert.equal(db.clips[0].duration_s, 7.3);
  const bad = fakeDb();
  assert.deepEqual(await trim(bad, { ...OWN, kind: "auto" as "own" }), { ok: true, dev: false, durationS: 7.3 }, "malformed points: same");
  assert.deepEqual(bad.log, ["GET video_clips", "PATCH video_clips"]);
});

test("accuracy: unusable points keep the cut on the phone (finishTrim done, no rollback)", async () => {
  const db = fakeDb();
  const files = memoryClipFiles();
  await files.writeFile(`${ID}.mp4`, new Blob([new Uint8Array(100)]));
  const deps: TrimDeps = {
    index: memoryClipIndex([entry()]),
    files,
    cut: fakeCut,
    lock: memoryLock(),
    trim: async (input) => trim(db, { ...input, outS: 99 }), // points past the original
  };
  const r = await startTrim(deps, ID, 1.04, 8.96, T0, "own");
  assert.equal(r.kind, "done");
  const toS = r.kind === "done" ? r.toS : null;
  assert.equal(await finishTrim(deps, ID, new Date(T0.getTime() + TRIM_UNDO_MS)), "done");
  const after = await deps.index.get(ID);
  assert.equal(after?.pendingTrim, undefined);
  assert.equal(after?.fileName, `${ID}.cut.mp4`, "the cut file is the clip");
  assert.equal(after?.durationS, toS);
  assert.equal(await files.readFile(`${ID}.mp4`), null, "the original is gone");
  assert.deepEqual(db.accuracy, [], "no record");
  assert.equal(db.clips[0].duration_s, toS, "the PATCH landed");
});

test("accuracy: failure injection, cut or lost reply at every request, then retry: one accuracy row and the PATCH landed", async () => {
  for (let at = 1; at <= 3; at += 1) {
    for (const afterApply of [false, true]) {
      const db = fakeDb();
      db.cut = { at, afterApply };
      const first = await trim(db, OWN);
      assert.deepEqual(first, { ok: false, reason: "failed" }, `at ${at} ${afterApply}`);
      if (at <= 2 && !(at === 2 && afterApply)) assert.equal(db.accuracy.length, 0, "no PATCH without the insert");
      if (at < 3 || !afterApply) assert.equal(db.clips[0].duration_s, 14.3, "the PATCH never ran before the insert landed");
      db.cut = undefined;
      assert.deepEqual(await trim(db, OWN), { ok: true, dev: false, durationS: 7.3 }, `retry at ${at} ${afterApply}`);
      assert.equal(db.accuracy.length, 1, `exactly one accuracy row (at ${at} ${afterApply})`);
      assert.deepEqual(db.accuracy[0], { ...ids, kind: "own", auto_in_s: 2.1, auto_out_s: 9.4, user_in_s: 1, user_out_s: 9, algo_version: ALGO_VERSION });
      assert.equal(db.clips[0].duration_s, 7.3, "the PATCH landed");
    }
  }
  // the named sequence: cut at the insert, retry cut at the PATCH, retry
  const db = fakeDb();
  db.cut = { at: 2, afterApply: false };
  assert.equal((await trim(db, OWN)).ok, false);
  db.cut = { at: db.requests + 3, afterApply: false };
  assert.equal((await trim(db, OWN)).ok, false);
  assert.equal(db.accuracy.length, 1);
  assert.equal(db.clips[0].duration_s, 14.3);
  db.cut = undefined;
  assert.equal((await trim(db, OWN)).ok, true);
  assert.equal(db.accuracy.length, 1);
  assert.equal(db.clips[0].duration_s, 7.3);
});

test("accuracy: a second cut of the same clip keeps the first record", async () => {
  const db = fakeDb();
  await trim(db, OWN);
  const first = { ...db.accuracy[0] };
  assert.deepEqual(await trim(db, { ...OWN, durationS: 4, inS: 1, outS: 5 }), { ok: true, dev: false, durationS: 4 });
  assert.deepEqual(db.accuracy, [first]);
  assert.equal(db.clips[0].duration_s, 4);
});

test("accuracy: a trim without points (an old pending cut) inserts nothing", async () => {
  const db = fakeDb();
  assert.deepEqual(await trim(db, { id: ID, durationS: 7.3 }), { ok: true, dev: false, durationS: 7.3 });
  assert.deepEqual(db.log, ["GET video_clips", "PATCH video_clips"]);
  assert.deepEqual(db.accuracy, []);
});

// --- the phone: the pending cut keeps its points; finishTrim sends them ----------------------------

const T0 = new Date("2026-10-22T16:00:00.000Z");

const entry = (over: Partial<ClipIndexEntry> = {}): ClipIndexEntry => ({
  id: ID,
  setKey: { date: "2026-10-22", sessionNo: 2, row: 30, set: 2 },
  ext: "mp4",
  recordedAt: "2026-10-22T08:00:00.000Z",
  durationS: 14.3,
  starred: false,
  starSynced: true,
  state: "done",
  ...over,
});

async function fakeCut(_file: Blob, inS: number, outS: number): Promise<CutResult> {
  const startS = Math.round((inS - 0.5) * 10) / 10; // the keyframe before in
  return { blob: new Blob([new Uint8Array(10)]), actual: { startS: Math.max(0, startS), endS: outS } };
}

async function phone(initial: ClipIndexEntry = entry()): Promise<{ deps: TrimDeps; sent: TrimRequest[] }> {
  const files = memoryClipFiles();
  await files.writeFile(`${ID}.mp4`, new Blob([new Uint8Array(100)]));
  const sent: TrimRequest[] = [];
  const deps: TrimDeps = {
    index: memoryClipIndex([initial]),
    files,
    cut: fakeCut,
    lock: memoryLock(),
    trim: async (input) => {
      sent.push(input);
      return { ok: true, dev: false, durationS: input.durationS };
    },
  };
  return { deps, sent };
}

test("accuracy: Gem klip's pending cut keeps the requested points (not the keyframe start), kind own and the analysing version; finishTrim sends them", async () => {
  const { deps: base, sent } = await phone();
  const deps = { ...base, autoVersionOf: () => 3 }; // this phone analysed the clip with version 3 (review: not the app's)
  const r = await startTrim(deps, ID, 1.04, 8.96, T0, "own");
  assert.equal(r.kind, "done");
  const p = (await deps.index.get(ID))?.pendingTrim;
  assert.deepEqual({ inS: p?.inS, outS: p?.outS, kind: p?.kind }, { inS: 1.04, outS: 8.96, kind: "own" });
  assert.equal(await finishTrim(deps, ID, new Date(T0.getTime() + TRIM_UNDO_MS)), "done");
  assert.deepEqual(sent, [{ id: ID, durationS: p?.newDurationS, inS: 1.04, outS: 8.96, kind: "own", algoVersion: 3 }]);
});

test("accuracy: without a recorded analysis version the request carries none (never the app's current version)", async () => {
  const { deps, sent } = await phone();
  await startTrim(deps, ID, 1.04, 8.96, T0, "own");
  await finishTrim(deps, ID, T0, { force: true });
  assert.equal(sent[0]?.algoVersion, undefined);
});

test("accuracy: startTrim takes kind approved (for Godkend alle)", async () => {
  const { deps, sent } = await phone();
  await startTrim(deps, ID, 2.1, 9.4, T0, "approved");
  await finishTrim(deps, ID, T0, { force: true });
  assert.equal(sent[0]?.kind, "approved");
});

test("accuracy: an old pending cut without points sends only id and duration", async () => {
  const pending = { deadline: T0.toISOString(), originalFileName: `${ID}.mp4`, originalDurationS: 14.3, newDurationS: 7.3 };
  const { deps, sent } = await phone(entry({ fileName: `${ID}.cut.mp4`, durationS: 7.3, pendingTrim: pending }));
  await deps.files.writeFile(`${ID}.cut.mp4`, new Blob([new Uint8Array(10)]));
  assert.equal(await finishTrim(deps, ID, T0), "done");
  assert.deepEqual(sent, [{ id: ID, durationS: 7.3 }]);
});
