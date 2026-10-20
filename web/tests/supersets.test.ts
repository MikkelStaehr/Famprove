import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { recordSetTap } from "../src/lib/db/set-log.ts";
import { recordSupersetPair, type SupersetOptions } from "../src/lib/db/superset-pairs.ts";
import { applyTap, type LoggedSet, nextOpen, sessionOrderWithAnyPairs, sessionOrderWithWarmups, setKey, type SetRef, type SetTapInput, shapeOrder } from "../src/lib/set-taps.ts";
import {
  effectivePairs,
  orderedEffectivePairs,
  type PairDecision,
  parseSupersetInput,
  pickRunRows,
  type SessionRun,
  sessionRuns,
  type SupersetInput,
  supersetHistoryRows,
  supersetPartners,
} from "../src/lib/supersets.ts";

// --- order -----------------------------------------------------------------------------------

function sets(spec: readonly [row: number, n: number, name: string][]) {
  return spec.flatMap(([row, n, name]) => Array.from({ length: n }, (_, k) => ({ ref: { row, set: k + 1 }, name })));
}
const show = (order: readonly SetRef[]) => order.map((r) => `${r.row}.${r.set}`).join(" ");

test("order: no pairs is the sheet's order with warm-ups, unchanged", () => {
  const s = sets([[10, 2, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"]]);
  assert.equal(show(sessionOrderWithWarmups(s)), "10.0 10.1 10.2 11.0 11.1 11.2 11.3 12.0 12.1 12.2 12.3");
  assert.deepEqual(sessionOrderWithWarmups(s, []), sessionOrderWithWarmups(s));
});

test("order: a pair interleaves by position, warm-ups first (3+3, 4+3, 3+4)", () => {
  const pair = [{ rowA: 11, rowB: 12 }];
  assert.equal(show(sessionOrderWithWarmups(sets([[10, 1, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"]]), pair)), "10.0 10.1 11.0 12.0 11.1 12.1 11.2 12.2 11.3 12.3");
  assert.equal(show(sessionOrderWithWarmups(sets([[11, 4, "Curl"], [12, 3, "Pushdown"]]), pair)), "11.0 12.0 11.1 12.1 11.2 12.2 11.3 12.3 11.4");
  assert.equal(show(sessionOrderWithWarmups(sets([[11, 3, "Curl"], [12, 4, "Pushdown"], [13, 1, "Dips"]]), pair)), "11.0 12.0 11.1 12.1 11.2 12.2 11.3 12.3 12.4 13.0 13.1");
});

test("order: a run over two rows interleaves as one run; a variant starts its own run", () => {
  const s = [...sets([[11, 2, "Curl"], [12, 1, "Curl"], [13, 3, "Pushdown"]])];
  assert.equal(show(sessionOrderWithWarmups(s, [{ rowA: 11, rowB: 13 }])), "11.0 13.0 11.1 13.1 11.2 13.2 12.1 13.3");
  const v = [{ ref: { row: 11, set: 1 }, name: "Curl", variantId: null }, { ref: { row: 12, set: 1 }, name: "Curl", variantId: 5 }];
  // Warm-ups follow the name only (Python's ramp does too): the variant row gets no set 0 of its own.
  assert.equal(show(sessionOrderWithWarmups(v)), "11.0 11.1 12.1");
  // ...but it is its own superset run; paired with the plain row, the warm-up still comes first.
  assert.equal(show(sessionOrderWithWarmups(v, [{ rowA: 11, rowB: 12 }])), "11.0 11.1 12.1");
});

test("order: a pair whose B has no warm-up keeps A0 first, then the working sets by position", () => {
  const v = [
    { ref: { row: 11, set: 1 }, name: "Curl", variantId: null },
    { ref: { row: 11, set: 2 }, name: "Curl", variantId: null },
    { ref: { row: 12, set: 1 }, name: "Curl", variantId: 5 },
    { ref: { row: 12, set: 2 }, name: "Curl", variantId: 5 },
  ];
  assert.equal(show(sessionOrderWithWarmups(v, [{ rowA: 11, rowB: 12 }])), "11.0 11.1 12.1 11.2 12.2");
});

// --- effectivePairs --------------------------------------------------------------------------

const RUNS: SessionRun[] = [
  { row: 10, exerciseId: 1, variantId: null, rows: [10], sets: 2 },
  { row: 11, exerciseId: 2, variantId: null, rows: [11], sets: 3 },
  { row: 12, exerciseId: 3, variantId: 7, rows: [12], sets: 3 },
  { row: 13, exerciseId: 4, variantId: null, rows: [13], sets: 3 },
];
function decision(d: Partial<PairDecision> & Pick<PairDecision, "rowA" | "rowB" | "exerciseA" | "exerciseB">): PairDecision {
  return { date: "2026-10-12", session: 1, variantA: null, variantB: null, paired: true, updatedAt: "2026-10-12T08:00:00Z", ...d };
}

test("effectivePairs: today's row decides, true or false, over history", () => {
  const history = [decision({ date: "2026-10-05", rowA: 11, rowB: 12, exerciseA: 2, exerciseB: 3, variantB: 7 })];
  assert.deepEqual(effectivePairs(RUNS, [decision({ rowA: 11, rowB: 12, exerciseA: 2, exerciseB: 3, variantB: 7, paired: false })], history), []);
  assert.deepEqual(effectivePairs(RUNS, [decision({ rowA: 11, rowB: 12, exerciseA: 2, exerciseB: 3, variantB: 7 })], []), [{ rowA: 11, rowB: 12, source: "today" }]);
});

test("effectivePairs: the latest earlier row suggests (true -> active, false -> none); null variant only matches null", () => {
  const on = decision({ date: "2026-10-01", rowA: 30, rowB: 31, exerciseA: 2, exerciseB: 3, variantB: 7 });
  const off = decision({ date: "2026-10-05", rowA: 30, rowB: 31, exerciseA: 2, exerciseB: 3, variantB: 7, paired: false });
  assert.deepEqual(effectivePairs(RUNS, [], [on]), [{ rowA: 11, rowB: 12, source: "suggested" }]);
  assert.deepEqual(effectivePairs(RUNS, [], [on, off]), []);
  assert.deepEqual(effectivePairs(RUNS, [], [{ ...on, variantB: null }]), []); // named != null
  assert.deepEqual(effectivePairs(RUNS, [], [{ ...on, exerciseA: 3, exerciseB: 2, variantA: 7, variantB: null }]), []); // ordered
});

test("effectivePairs: first pair wins on overlap; a stale row_b is ignored", () => {
  const ab = decision({ rowA: 10, rowB: 11, exerciseA: 1, exerciseB: 2 });
  const bc = decision({ rowA: 11, rowB: 12, exerciseA: 2, exerciseB: 3, variantB: 7 });
  assert.deepEqual(effectivePairs(RUNS, [ab, bc], []), [{ rowA: 10, rowB: 11, source: "today" }]);
  const cd = decision({ rowA: 12, rowB: 13, exerciseA: 3, variantA: 7, exerciseB: 4 });
  assert.deepEqual(effectivePairs(RUNS, [ab, cd], []).map((p) => p.rowA), [10, 12]);
  const stale = decision({ rowA: 11, rowB: 14, exerciseA: 2, exerciseB: 3, variantB: 7 });
  assert.deepEqual(effectivePairs(RUNS, [stale], []), []);
});

test("parseSupersetInput: exact shape only", () => {
  assert.deepEqual(parseSupersetInput({ date: "2026-10-12", sessionNo: 1, rowA: 11, rowB: 12, paired: true }), { date: "2026-10-12", sessionNo: 1, rowA: 11, rowB: 12, paired: true });
  for (const bad of [null, {}, { date: "2026-10-12", sessionNo: 1, rowA: 11, rowB: 11, paired: true }, { date: "x", sessionNo: 1, rowA: 11, rowB: 12, paired: true }, { date: "2026-10-12", sessionNo: 1, rowA: 11, rowB: 12, paired: "yes" }]) {
    assert.equal(parseSupersetInput(bad), null);
  }
});

// --- fake PostgREST ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; requests: number; failAt?: number; writes: number };

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    const value = rest.join(".");
    const cell = row[column];
    if (op === "is" && value === "null" && cell !== null) return false;
    if (op === "is" && value === "false" && cell !== false) return false;
    if (op === "eq" && String(cell) !== value) return false;
    if (op === "lt" && !(String(cell) < value)) return false;
    if (op === "lte" && !(String(cell) <= value)) return false;
    if (op === "in" && !value.slice(1, -1).split(",").includes(String(cell))) return false;
  }
  return true;
}

// Squat 2 sets (row 10), Curl 3 (11), Pushdown 3 (12), Dips 1 (13).
function fakeDb(): FakeDb {
  const sheet: [number, number, string][] = [[10, 2, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"], [13, 1, "Dips"]];
  return {
    tables: {
      strength_sets: sheet.flatMap(([sheet_row, n, name]) =>
        Array.from({ length: n }, (_, k) => ({ week_start: "2026-10-12", session: 1, sheet_row, set_no: k + 1, name, reps_text: "3", variant_id: null })),
      ),
      exercises: [
        { id: 1, name: "Squat", aliases: [] },
        { id: 2, name: "Curl", aliases: [] },
        { id: 3, name: "Pushdown", aliases: [] },
        { id: 4, name: "Dips", aliases: [] },
      ],
      exercise_set_log: [],
      session_order: [],
      superset_pairs: [],
    },
    requests: 0,
    writes: 0,
  };
}

function fetchFor(db: FakeDb): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    const method = init.method ?? "GET";
    db.requests += 1;
    if (db.failAt !== undefined && db.requests >= db.failAt) return new Response("{}", { status: 503 });
    const rows = db.tables[table];
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : {};
    if (method === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      return new Response(JSON.stringify(found), { headers: { "Content-Range": found.length ? `0-${found.length - 1}/${found.length}` : "*/0" } });
    }
    db.writes += 1;
    const headers = new Headers(init.headers);
    if (method === "POST" && table === "superset_pairs") {
      assert.match(headers.get("Prefer") ?? "", /resolution=merge-duplicates/);
      const pk = ["date", "session_no", "row_a"];
      const hit = rows.find((r) => pk.every((k) => r[k] === body[k]));
      if (hit === undefined) rows.push({ ...body });
      else Object.assign(hit, body);
    } else if (method === "POST" && table === "session_order") {
      const pk = ["date", "session_no"];
      const hit = rows.find((r) => pk.every((k) => r[k] === body[k]));
      if (hit === undefined) rows.push({ previous_rows: null, jumped_at: null, moved_start: null, ...body });
      else Object.assign(hit, body);
    } else if (method === "POST") {
      const pk = ["date", "session_no", "row_no", "set_no"];
      if (!rows.some((r) => pk.every((k) => r[k] === body[k]))) rows.push({ started_at: null, ended_at: null, skipped: false, felt_rpe: null, reps_done: null, ...body });
    } else if (method === "PATCH") {
      for (const r of rows.filter((x) => matches(x, parsed.searchParams))) Object.assign(r, body);
    } else if (method === "DELETE") {
      assert.notEqual(table, "superset_pairs", "superset_pairs is never deleted from");
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

const opts = (db: FakeDb, env: Record<string, string> = {}, nodeEnv = "production"): SupersetOptions => ({
  env,
  nodeEnv,
  client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)),
});
const NOW = new Date("2026-10-12T08:00:00.000Z");
const at = (m: number) => new Date(NOW.getTime() + m * 60_000);
const pairInput = (paired: boolean, rowA = 11, rowB = 12): SupersetInput => ({ date: "2026-10-12", sessionNo: 1, rowA, rowB, paired });
console.error = () => {}; // refused saves are logged

// --- write path ----------------------------------------------------------------------------------

test("setSupersetPair: the double upsert, and the opposite upsert, leave one row in the desired state", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordSupersetPair(pairInput(true), NOW, opts(db)), { ok: true, pairs: [{ rowA: 11, rowB: 12, source: "today" }] });
  assert.deepEqual(await recordSupersetPair(pairInput(true), at(1), opts(db)), { ok: true, pairs: [{ rowA: 11, rowB: 12, source: "today" }] });
  assert.equal(db.tables.superset_pairs.length, 1);
  assert.deepEqual(await recordSupersetPair(pairInput(false), at(2), opts(db)), { ok: true, pairs: [] });
  assert.equal(db.tables.superset_pairs.length, 1);
  const row = db.tables.superset_pairs[0];
  assert.deepEqual(
    [row.paired, row.exercise_a, row.variant_a, row.exercise_b, row.variant_b, row.updated_at],
    [false, 2, null, 3, null, at(2).toISOString()],
  );
});

test("setSupersetPair: every refusal writes nothing", async () => {
  const cases: [string, SupersetInput, (db: FakeDb) => void, Record<string, string>?][] = [
    ["not_today", { ...pairInput(true), date: "2026-10-13" }, () => {}],
    ["no_session", { ...pairInput(true), sessionNo: 2 }, () => {}],
    // Since slice superset-any a non-neighbour (10 -> 12, 11 -> 13) is a pick: B = A or a row that starts no run is refused.
    ["not_consecutive", pairInput(true, 11, 11), () => {}],
    ["not_consecutive", pairInput(true, 11, 14), () => {}],
    ["started", pairInput(true), (db) => db.tables.exercise_set_log.push({ date: "2026-10-12", session_no: 1, row_no: 12, set_no: 0, kind: "warmup", started_at: NOW.toISOString(), ended_at: null, skipped: false, updated_at: NOW.toISOString(), felt_rpe: null, reps_done: null })],
    ["overlap", pairInput(true, 12, 13), (db) => db.tables.superset_pairs.push({ date: "2026-10-12", session_no: 1, row_a: 11, row_b: 12, exercise_a: 2, variant_a: null, exercise_b: 3, variant_b: null, paired: true, updated_at: NOW.toISOString() })],
  ];
  for (const [reason, input, setup] of cases) {
    const db = fakeDb();
    setup(db);
    assert.deepEqual(await recordSupersetPair(input, NOW, opts(db)), { ok: false, reason }, reason);
    assert.equal(db.writes, 0, reason);
  }
  // A's warm-up alone does not lock the pair.
  const db = fakeDb();
  db.tables.exercise_set_log.push({ date: "2026-10-12", session_no: 1, row_no: 11, set_no: 0, kind: "warmup", started_at: NOW.toISOString(), ended_at: null, skipped: false, updated_at: NOW.toISOString(), felt_rpe: null, reps_done: null });
  assert.equal((await recordSupersetPair(pairInput(true), NOW, opts(db))).ok, true);
  // Dev switches: the result, nothing written.
  const dev = fakeDb();
  assert.deepEqual(await recordSupersetPair(pairInput(true), NOW, opts(dev, { DEV_FIXTURE: "superset" }, "development")), { ok: true, pairs: [{ rowA: 11, rowB: 12, source: "today" }] });
  assert.equal(dev.writes, 0);
});

test("setSupersetPair: cut at every request, then retried, reaches the desired state", async () => {
  for (let n = 1; n <= 8; n++) {
    const db = fakeDb();
    db.failAt = n;
    await recordSupersetPair(pairInput(true), NOW, opts(db));
    db.failAt = undefined;
    assert.deepEqual(await recordSupersetPair(pairInput(true), at(1), opts(db)), { ok: true, pairs: [{ rowA: 11, rowB: 12, source: "today" }] }, `split ${n}`);
    assert.equal(db.tables.superset_pairs.length, 1, `split ${n}`);
    assert.equal(db.tables.superset_pairs[0].paired, true, `split ${n}`);
  }
});

// --- set log in a paired session ------------------------------------------------------------------

const tap = (kind: SetTapInput["kind"], row: number, set: number, undoes: SetTapInput["undoes"] = null): SetTapInput => ({ kind, date: "2026-10-12", session: 1, row, set, undoes });
const tapOpts = (db: FakeDb) => ({ env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) });
function dbLog(db: FakeDb): Map<string, LoggedSet> {
  return new Map(
    db.tables.exercise_set_log.map((r) => {
      const l: LoggedSet = { row: Number(r.row_no), set: Number(r.set_no), startedAt: (r.started_at as string | null) ?? null, endedAt: (r.ended_at as string | null) ?? null, skipped: r.skipped === true, skippedAt: (r.skipped_at as string | null) ?? null, updatedAt: (r.updated_at as string | null) ?? null };
      return [setKey(l), l];
    }),
  );
}
const PAIRED_ORDER = sessionOrderWithWarmups(
  fakeDb().tables.strength_sets.map((s) => ({ ref: { row: Number(s.sheet_row), set: Number(s.set_no) }, name: String(s.name) })),
  [{ rowA: 11, rowB: 12 }],
);

test("set log with a pair: A's done starts B's set, B's done starts A's next; server == client mirror", async () => {
  const db = fakeDb();
  await recordSupersetPair(pairInput(true), NOW, opts(db));
  let mirror = new Map<string, LoggedSet>();
  const steps: [SetTapInput, number][] = [[tap("begin", 10, 0), 1], [tap("done", 10, 0), 2], [tap("done", 10, 1), 3], [tap("done", 10, 2), 4], [tap("done", 11, 0), 5], [tap("done", 12, 0), 6], [tap("done", 11, 1), 7], [tap("done", 12, 1), 8], [tap("skip", 11, 2), 9]];
  for (const [input, m] of steps) {
    const r = await recordSetTap(input, at(m), tapOpts(db));
    assert.equal(r.ok, true, `${input.kind} ${input.row}.${input.set}`);
    mirror = applyTap(PAIRED_ORDER, mirror, input.kind, { row: input.row, set: input.set }, at(m).toISOString());
    const server = dbLog(db);
    for (const [k, l] of mirror) {
      assert.equal(server.get(k)?.startedAt ?? null, l.startedAt, `${k} start after ${input.kind} ${input.row}.${input.set}`);
      assert.equal(server.get(k)?.endedAt ?? null, l.endedAt, `${k} end`);
      assert.equal(server.get(k)?.skipped ?? false, l.skipped, `${k} skipped`);
    }
    assert.equal(server.size, mirror.size, `rows after ${input.kind} ${input.row}.${input.set}`);
  }
  const log = dbLog(db);
  assert.equal(log.get("12#1")?.startedAt, log.get("11#1")?.endedAt, "A1's done starts B1");
  assert.equal(log.get("11#2")?.startedAt, null, "A2 skipped");
  assert.equal(log.get("12#2")?.startedAt, log.get("11#2")?.updatedAt, "the skip of A2 starts B2");
  assert.deepEqual(nextOpen(PAIRED_ORDER, log, { row: 12, set: 1 }), { row: 12, set: 2 });
});

test("set log with a pair: A1's done cut at every request and retried -> A1 ended and B1 started, one T", async () => {
  for (let n = 1; n <= 16; n++) {
    const db = fakeDb();
    await recordSupersetPair(pairInput(true), NOW, opts(db));
    for (const [input, m] of [[tap("begin", 11, 0), 1], [tap("done", 11, 0), 2], [tap("done", 12, 0), 3]] as const) {
      assert.equal((await recordSetTap(input, at(m), tapOpts(db))).ok, true);
    }
    db.requests = 0;
    db.failAt = n;
    await recordSetTap(tap("done", 11, 1), at(5), tapOpts(db));
    db.failAt = undefined;
    assert.equal((await recordSetTap(tap("done", 11, 1), at(6), tapOpts(db))).ok, true, `split ${n}: retry`);
    const log = dbLog(db);
    const a1 = log.get("11#1");
    assert.ok(a1?.endedAt != null, `split ${n}: A1 ended`);
    assert.equal(log.get("12#1")?.startedAt, a1?.endedAt, `split ${n}: B1 starts at A1's end`);
    assert.equal(log.get("11#2"), undefined, `split ${n}: A2 not started`);
    for (const l of log.values()) assert.ok(l.startedAt === null || l.endedAt === null || Date.parse(l.endedAt) >= Date.parse(l.startedAt), `split ${n}: span`);
  }
});

// --- any partner (slice superset-any, 2026-10-20) -------------------------------------------------

const SHEET_SETS = ([[10, 2, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"], [13, 1, "Dips"]] as const).flatMap(([row, n, name]) =>
  Array.from({ length: n }, (_, k) => ({ ref: { row, set: k + 1 }, name, variantId: null })),
);
const IDS = new Map([["squat", 1], ["curl", 2], ["pushdown", 3], ["dips", 4]]);

const orderOf = (db: FakeDb) => db.tables.session_order.find((r) => r.date === "2026-10-12" && r.session_no === 1)?.run_rows ?? null;

test("superset-any: a non-neighbour moves right after A (A, B, then the old neighbour), the pair in force", async () => {
  const db = fakeDb();
  const want = { ok: true, pairs: [{ rowA: 10, rowB: 12, source: "today" }], runRows: [10, 12, 11, 13] };
  assert.deepEqual(await recordSupersetPair(pairInput(true, 10, 12), NOW, opts(db)), want);
  assert.deepEqual(orderOf(db), [10, 12, 11, 13]);
  assert.equal(db.writes, 2); // the order, then the pair
  // A reload (the same request again, read from the stored state) gives the same state and writes only the idempotent pair.
  assert.deepEqual(await recordSupersetPair(pairInput(true, 10, 12), at(1), opts(db)), want);
  assert.equal(db.writes, 3);
  // The server's tap order follows it: A0, B0, A1, B1, A2, B2, B3, then Curl, Dips.
  await recordSetTap(tap("begin", 10, 0), at(2), tapOpts(db));
  await recordSetTap(tap("done", 10, 0), at(3), tapOpts(db));
  const started = db.tables.exercise_set_log.filter((r) => r.started_at !== null).map((r) => `${r.row_no}/${r.set_no}`);
  assert.deepEqual(started, ["10/0", "12/0"]);
  // B before A in the sheet: Pushdown (12) with Squat (10) -> Curl, Pushdown, Squat, Dips.
  const other = fakeDb();
  assert.deepEqual(await recordSupersetPair(pairInput(true, 12, 10), NOW, opts(other)), { ok: true, pairs: [{ rowA: 12, rowB: 10, source: "today" }], runRows: [11, 12, 10, 13] });
});

test("superset-any: refusals (started, B = A, in another pair, not today) write nothing", async () => {
  const log = (row: number, set: number) => ({ date: "2026-10-12", session_no: 1, row_no: row, set_no: set, kind: set === 0 ? "warmup" : "set", started_at: NOW.toISOString(), ended_at: null, skipped: false, updated_at: NOW.toISOString(), felt_rpe: null, reps_done: null });
  const pair = (a: number, b: number, ea: number, eb: number) => ({ date: "2026-10-12", session_no: 1, row_a: a, row_b: b, exercise_a: ea, variant_a: null, exercise_b: eb, variant_b: null, paired: true, updated_at: NOW.toISOString() });
  const cases: [string, SupersetInput, (db: FakeDb) => void][] = [
    ["started", pairInput(true, 10, 12), (db) => db.tables.exercise_set_log.push(log(12, 0))],
    ["started", pairInput(true, 10, 12), (db) => db.tables.exercise_set_log.push(log(10, 1))],
    ["not_consecutive", pairInput(true, 12, 12), () => {}],
    ["overlap", pairInput(true, 10, 12), (db) => db.tables.superset_pairs.push(pair(11, 12, 2, 3))],
    ["not_today", { ...pairInput(true, 10, 12), date: "2026-10-11" }, () => {}],
  ];
  for (const [reason, input, setup] of cases) {
    const db = fakeDb();
    setup(db);
    assert.deepEqual(await recordSupersetPair(input, NOW, opts(db)), { ok: false, reason }, reason);
    assert.equal(db.writes, 0, reason);
  }
});

test("superset-any: unpairing writes paired false only and keeps the order", async () => {
  const db = fakeDb();
  await recordSupersetPair(pairInput(true, 10, 12), NOW, opts(db));
  const writes = db.writes;
  assert.deepEqual(await recordSupersetPair(pairInput(false, 10, 12), at(1), opts(db)), { ok: true, pairs: [], runRows: [10, 12, 11, 13] });
  assert.equal(db.writes, writes + 1);
  assert.deepEqual(orderOf(db), [10, 12, 11, 13]);
  assert.equal(db.tables.superset_pairs[0].paired, false);
});

test("superset-any: a jump's undo mark stays as it is when a pick moves the order", async () => {
  const db = fakeDb();
  db.tables.session_order.push({ date: "2026-10-12", session_no: 1, run_rows: [11, 10, 12, 13], previous_rows: [10, 11, 12, 13], jumped_at: NOW.toISOString(), moved_start: null, updated_at: NOW.toISOString() });
  assert.equal((await recordSupersetPair(pairInput(true, 11, 13), at(1), opts(db))).ok, true);
  const row = db.tables.session_order[0];
  assert.deepEqual([row.run_rows, row.previous_rows, row.jumped_at], [[11, 13, 10, 12], [10, 11, 12, 13], NOW.toISOString()]);
});

test("superset-any: cut at each request, then retried, reaches the order and the pair", async () => {
  for (let n = 1; n <= 9; n++) {
    const db = fakeDb();
    db.failAt = n;
    await recordSupersetPair(pairInput(true, 10, 12), NOW, opts(db));
    db.failAt = undefined;
    assert.deepEqual(await recordSupersetPair(pairInput(true, 10, 12), at(1), opts(db)), { ok: true, pairs: [{ rowA: 10, rowB: 12, source: "today" }], runRows: [10, 12, 11, 13] }, `split ${n}`);
    assert.deepEqual(orderOf(db), [10, 12, 11, 13], `split ${n}`);
    assert.equal(db.tables.superset_pairs.length, 1, `split ${n}`);
    assert.equal(db.tables.superset_pairs[0].paired, true, `split ${n}`);
  }
});

test("superset-any: partners list every unstarted run not in a pair, Som sidst first, in the session's order", () => {
  const runs = sessionRuns(SHEET_SETS, IDS);
  const history = [
    { date: "2026-10-05", session: 1, rowA: 10, rowB: 13, exerciseA: 1, variantA: null, exerciseB: 4, variantB: null, paired: true, updatedAt: "2026-10-05T08:00:00Z" },
    { date: "2026-09-28", session: 1, rowA: 10, rowB: 11, exerciseA: 1, variantA: null, exerciseB: 2, variantB: null, paired: true, updatedAt: "2026-09-28T08:00:00Z" },
  ];
  const last = supersetHistoryRows(runs, history).find((h) => h.rowA === 10)?.rowsB ?? [];
  assert.deepEqual(last, [13, 11]);
  assert.deepEqual(supersetPartners(runs, null, [], [], 10, last), [{ row: 13, lastTime: true }, { row: 11, lastTime: false }, { row: 12, lastTime: false }]);
  // Som sidst is never applied unless B is A's neighbour: 13 is not, so no pair in force.
  assert.deepEqual(orderedEffectivePairs(runs, [], history.slice(0, 1), null), []);
  // A started run (Curl) and a run in a pair drop out; A started: no list.
  assert.deepEqual(supersetPartners(runs, null, [{ rowA: 12, rowB: 13 }], [{ row: 11, set: 1 }], 10, last), []);
  assert.equal(supersetPartners(runs, null, [], [{ row: 10, set: 1 }], 10, last), null);
  assert.notEqual(supersetPartners(runs, null, [], [{ row: 10, set: 0 }], 10, last), null); // A's warm-up begun is fine
  // In the session's order after a pick.
  assert.deepEqual(supersetPartners(runs, [10, 12, 11, 13], [], [], 11, []), [{ row: 10, lastTime: false }, { row: 12, lastTime: false }, { row: 13, lastTime: false }]);
});

test("superset-any: the tap order interleaves a pair apart in the sheet; neighbours as before", () => {
  const pairsApart = [{ rowA: 10, rowB: 12 }];
  const order = shapeOrder({ sets: SHEET_SETS, pairs: pairsApart, runRows: [10, 12, 11, 13] }).map((r) => `${r.row}/${r.set}`);
  assert.deepEqual(order, ["10/0", "12/0", "10/1", "12/1", "10/2", "12/2", "12/3", "11/0", "11/1", "11/2", "11/3", "13/0", "13/1"]);
  const neighbours = [{ rowA: 11, rowB: 12 }];
  assert.deepEqual(sessionOrderWithAnyPairs(SHEET_SETS, neighbours), sessionOrderWithWarmups(SHEET_SETS, neighbours));
  assert.deepEqual(pickRunRows(sessionRuns(SHEET_SETS, IDS), null, 11, 12), null); // already next to A: no order write
});
