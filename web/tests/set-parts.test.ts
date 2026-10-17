import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { COMBO_VARIANT, comboParts } from "../src/lib/db/dev-fixture.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { recordSetParts, type SetPartsOptions } from "../src/lib/db/set-parts.ts";
import { type PartsData, parseSetPartsInput, partsFor, type SetPartRow, type SetPartsInput } from "../src/lib/set-parts.ts";

// --- fake PostgREST ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; requests: number; failAt?: number; posts: number };
const PK = ["date", "session_no", "row_no", "set_no", "part_no"];

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    if (op === "eq" && String(row[column]) !== rest.join(".")) return false;
  }
  return true;
}

// Session 1: row 20 = Abs with variant 7 (2 sets), row 21 = Curl without a variant (1 set). Set 20#1 done.
function fakeDb(): FakeDb {
  return {
    tables: {
      strength_sets: [
        { week_start: "2026-10-12", session: 1, sheet_row: 20, set_no: 1, name: "Abs of choice", reps_text: "10", variant_id: 7 },
        { week_start: "2026-10-12", session: 1, sheet_row: 20, set_no: 2, name: "Abs of choice", reps_text: "10", variant_id: 7 },
        { week_start: "2026-10-12", session: 1, sheet_row: 21, set_no: 1, name: "Curl", reps_text: "10", variant_id: null },
      ],
      exercise_set_log: [
        { date: "2026-10-12", session_no: 1, row_no: 20, set_no: 1, kind: "set", started_at: "2026-10-12T07:50:00.000Z", ended_at: "2026-10-12T07:55:00.000Z", skipped: false, skipped_at: null, updated_at: "2026-10-12T07:55:00.000Z", felt_rpe: null, reps_done: null },
        { date: "2026-10-12", session_no: 1, row_no: 21, set_no: 1, kind: "set", started_at: "2026-10-12T07:56:00.000Z", ended_at: "2026-10-12T07:58:00.000Z", skipped: false, skipped_at: null, updated_at: "2026-10-12T07:58:00.000Z", felt_rpe: null, reps_done: null },
      ],
      exercise_variant_parts: [
        { variant_id: 7, part_no: 1, name: "Palloff", per_side: true },
        { variant_id: 7, part_no: 2, name: "Weighted situps", per_side: false },
      ],
      exercise_set_parts: [],
    },
    requests: 0,
    posts: 0,
  };
}

function fetchFor(db: FakeDb): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    db.requests += 1;
    if (db.failAt !== undefined && db.requests >= db.failAt) return new Response("{}", { status: 503 });
    const rows = db.tables[table];
    if ((init.method ?? "GET") === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      return new Response(JSON.stringify(found), { headers: { "Content-Range": found.length ? `0-${found.length - 1}/${found.length}` : "*/0" } });
    }
    assert.equal(init.method, "POST");
    assert.equal(table, "exercise_set_parts");
    assert.match(new Headers(init.headers).get("Prefer") ?? "", /resolution=merge-duplicates/);
    assert.equal(parsed.searchParams.get("on_conflict"), PK.join(","));
    db.posts += 1;
    const body = JSON.parse(String(init.body)) as Row[];
    assert.ok(Array.isArray(body), "one bulk request");
    for (const b of body) {
      const hit = rows.find((r) => PK.every((k) => r[k] === b[k]));
      if (hit === undefined) rows.push({ ...b });
      else Object.assign(hit, b);
    }
    return new Response(null, { status: 201 });
  };
}

const opts = (db: FakeDb, env: Record<string, string> = {}, nodeEnv = "production"): SetPartsOptions => ({
  env,
  nodeEnv,
  client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)),
});
const NOW = new Date("2026-10-12T08:00:00.000Z");
const input = (over: Partial<SetPartsInput> = {}): SetPartsInput => ({
  date: "2026-10-12",
  sessionNo: 1,
  row: 20,
  set: 1,
  parts: [
    { partNo: 1, kg: 12.5, reps: 10, perSide: true },
    { partNo: 2, kg: 0, reps: 12, perSide: false },
  ],
  ...over,
});
console.error = () => {}; // refused saves are logged

// --- parse ---------------------------------------------------------------------------------------

test("parseSetPartsInput: the exact shape, kg 0–500 or null, reps 1–200 or null", () => {
  const ok = { date: "2026-10-12", sessionNo: 1, row: 20, set: 1, parts: [{ partNo: 1, kg: 0, reps: null, perSide: true }] };
  assert.deepEqual(parseSetPartsInput(ok), ok);
  assert.deepEqual(parseSetPartsInput({ ...ok, parts: [{ partNo: 1, kg: null, reps: 200, perSide: false }] })?.parts[0], { partNo: 1, kg: null, reps: 200, perSide: false });
  assert.equal(parseSetPartsInput({ ...ok, parts: [{ partNo: 1, kg: 500, reps: 1, perSide: false }] })?.parts[0].kg, 500);
  const bad: unknown[] = [
    null,
    "x",
    { ...ok, date: "12-10-2026" },
    { ...ok, sessionNo: 0 },
    { ...ok, row: 1.5 },
    { ...ok, set: "1" },
    { ...ok, parts: [] },
    { ...ok, parts: "x" },
    { ...ok, parts: [{ partNo: 1, kg: -1, reps: 1, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: 500.5, reps: 1, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: "12,5", reps: 1, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: Number.NaN, reps: 1, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: 1, reps: 0, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: 1, reps: 201, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: 1, reps: 2.5, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: 1, reps: 2 }] },
    { ...ok, parts: [{ partNo: 0, kg: 1, reps: 2, perSide: true }] },
    { ...ok, parts: [{ partNo: 1, kg: 1, reps: 2, perSide: true }, { partNo: 1, kg: 2, reps: 2, perSide: true }] },
  ];
  for (const raw of bad) assert.equal(parseSetPartsInput(raw), null, JSON.stringify(raw));
});

// --- refusals ------------------------------------------------------------------------------------

test("setSetParts: refused (no write) unless today, the set in the session, done, with parts, and known parts", async () => {
  const cases: [SetPartsInput, string][] = [
    [input({ date: "2026-10-11" }), "not_today"],
    [input({ row: 99 }), "no_set"],
    [input({ set: 2 }), "not_done"],
    [input({ row: 21 }), "no_parts"],
    [input({ parts: [{ partNo: 3, kg: 1, reps: 1, perSide: false }] }), "unknown_part"],
  ];
  for (const [i, reason] of cases) {
    const db = fakeDb();
    assert.deepEqual(await recordSetParts(i, NOW, opts(db)), { ok: false, reason }, reason);
    assert.equal(db.posts, 0, reason);
  }
  const db = fakeDb();
  db.tables.exercise_variant_parts = [];
  assert.deepEqual(await recordSetParts(input(), NOW, opts(db)), { ok: false, reason: "no_parts" });
  const skipped = fakeDb();
  Object.assign(skipped.tables.exercise_set_log[0], { started_at: null, ended_at: null, skipped: true, skipped_at: "2026-10-12T07:55:00.000Z" });
  assert.deepEqual(await recordSetParts(input(), NOW, opts(skipped)), { ok: false, reason: "not_done" });
});

test("setSetParts: a dev switch reads and writes nothing and answers with what would be stored", async () => {
  const db = fakeDb();
  const result = await recordSetParts(input({ date: "2026-01-01" }), NOW, opts(db, { DEV_FIXTURE: "combo" }, "development"));
  assert.deepEqual(result, { ok: true, dev: true, stored: { row: 20, set: 1, parts: input().parts } });
  assert.equal(db.requests, 0);
});

// --- one request, idempotent ---------------------------------------------------------------------

test("setSetParts: one bulk upsert; a double save and a changed save leave one row per part", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordSetParts(input(), NOW, opts(db)), { ok: true, dev: false, stored: { row: 20, set: 1, parts: input().parts } });
  assert.equal(db.posts, 1);
  await recordSetParts(input(), new Date(NOW.getTime() + 1000), opts(db));
  await recordSetParts(input({ parts: [{ partNo: 2, kg: 5, reps: 12, perSide: true }] }), new Date(NOW.getTime() + 2000), opts(db));
  const rows = db.tables.exercise_set_parts;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.part_no, r.variant_id, r.kg, r.reps, r.per_side]), [[1, 7, 12.5, 10, true], [2, 7, 5, 12, true]]);
  assert.equal(rows[1].updated_at, "2026-10-12T08:00:02.000Z");
});

test("setSetParts: cut at every request, then retried, reaches the wanted state", async () => {
  for (let n = 1; n <= 4; n++) {
    const db = fakeDb();
    db.failAt = n;
    assert.deepEqual(await recordSetParts(input(), NOW, opts(db)), { ok: false, reason: "failed" }, `cut ${n}`);
    db.failAt = undefined;
    assert.equal((await recordSetParts(input(), NOW, opts(db))).ok, true, `cut ${n}`);
    assert.deepEqual(db.tables.exercise_set_parts.map((r) => [r.part_no, r.kg, r.reps, r.per_side]), [[1, 12.5, 10, true], [2, 0, 12, false]], `cut ${n}`);
  }
});

// --- pre-fill ------------------------------------------------------------------------------------

const part = (over: Partial<SetPartRow>): SetPartRow => ({
  date: "2026-10-12",
  session: 1,
  row: 20,
  set: 1,
  partNo: 1,
  variantId: 7,
  kg: 10,
  reps: 10,
  perSide: false,
  updatedAt: "2026-10-12T08:00:00.000Z",
  ...over,
});
const PARTS: PartsData["variantParts"] = [
  { variantId: 7, partNo: 2, name: "Weighted situps", perSide: false },
  { variantId: 7, partNo: 1, name: "Palloff", perSide: true },
];

test("partsFor: this set's logged row, then the last time (an earlier set today, else an earlier day), then the default", () => {
  const data: PartsData = {
    variantParts: PARTS,
    today: [
      part({ set: 2, partNo: 1, kg: 15, reps: 8, perSide: true }), // logged on the set itself
      part({ set: 1, partNo: 2, kg: 7.5, reps: 11, updatedAt: "2026-10-12T07:55:00.000Z" }), // set 1 today
    ],
    last: [part({ date: "2026-10-05", partNo: 2, kg: 5, reps: 12 }), part({ date: "2026-10-05", partNo: 1, kg: 10, reps: 9, perSide: false })],
  };
  assert.deepEqual(partsFor(data, 1, { row: 20, set: 2 }, 7), {
    row: 20,
    set: 2,
    parts: [
      { partNo: 1, name: "Palloff", kg: 15, reps: 8, perSide: true, from: "logged" },
      { partNo: 2, name: "Weighted situps", kg: 7.5, reps: 11, perSide: false, from: "last" },
    ],
  });
  // Nothing today: an earlier day; never logged: the default per-side, kg and reps empty (null, not 0).
  const fresh: PartsData = { variantParts: PARTS, today: [], last: [part({ date: "2026-10-05", partNo: 2, kg: 0, reps: 12 })] };
  assert.deepEqual(partsFor(fresh, 1, { row: 20, set: 1 }, 7)?.parts, [
    { partNo: 1, name: "Palloff", kg: null, reps: null, perSide: true, from: "default" },
    { partNo: 2, name: "Weighted situps", kg: 0, reps: 12, perSide: false, from: "last" },
  ]);
  assert.equal(partsFor(fresh, 1, { row: 20, set: 1 }, null), null);
  assert.equal(partsFor(fresh, 1, { row: 20, set: 1 }, 8), null);
});

test("DEV_FIXTURE=combo: the parts view after the done of a combined variant's set (snapshot)", () => {
  assert.deepEqual(partsFor(comboParts("2026-10-17"), 1, { row: 30, set: 2 }, COMBO_VARIANT.variantId), {
    row: 30,
    set: 2,
    parts: [
      { partNo: 1, name: "Split squat", kg: 12.5, reps: 8, perSide: true, from: "last" },
      { partNo: 2, name: "Calf raise", kg: 20, reps: 12, perSide: false, from: "last" },
    ],
  });
});

// --- Python never reads the tables ---------------------------------------------------------------

test("python/src never names exercise_set_parts or exercise_variant_parts (TSS unchanged)", () => {
  const root = fileURLToPath(new URL("../../python/src", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".py"));
  assert.ok(files.length > 10);
  const hits = files.filter((f) => /exercise_set_parts|exercise_variant_parts/.test(readFileSync(join(root, f), "utf8")));
  assert.deepEqual(hits, []);
});
