// Tester's independent checks for slices supersets / fokus-flow (2026-10-16). Fakes only: no database.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { recordSetTap } from "../src/lib/db/set-log.ts";
import { recordSupersetPair, type SupersetOptions } from "../src/lib/db/superset-pairs.ts";
import { fokusState } from "../src/lib/fokus-view.ts";
import { type LoggedSet, sessionOrderWithWarmups, setKey, type SetRef, type SetTapInput } from "../src/lib/set-taps.ts";
import { clientOrder, pairHandOff } from "../src/lib/superset-view.ts";
import { effectivePairs, type PairDecision, type SessionRun, type SupersetInput } from "../src/lib/supersets.ts";

const show = (o: readonly SetRef[]) => o.map((r) => `${r.row}.${r.set}`).join(" ");
const sets = (spec: readonly [number, number, string][]) =>
  spec.flatMap(([row, n, name]) => Array.from({ length: n }, (_, k) => ({ ref: { row, set: k + 1 }, name, variantId: null })));

test("S-a: every nA + nB in 1..6 interleaves A0 B0 A1 B1 …, the longer run's tail alone, each set exactly once", () => {
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const s = sets([[11, a, "Curl"], [12, b, "Pushdown"]]);
      const want = ["11.0", "12.0"];
      for (let k = 1; k <= Math.max(a, b); k++) {
        if (k <= a) want.push(`11.${k}`);
        if (k <= b) want.push(`12.${k}`);
      }
      const got = show(sessionOrderWithWarmups(s, [{ rowA: 11, rowB: 12 }]));
      assert.equal(got, want.join(" "), `${a}+${b}`);
      assert.equal(new Set(got.split(" ")).size, a + b + 2, `${a}+${b} unique`);
      assert.equal(show(sessionOrderWithWarmups(s, [])), show(sessionOrderWithWarmups(s)), `${a}+${b} no pairs`);
      assert.equal(show(sessionOrderWithWarmups(s)), ["11.0", ...Array.from({ length: a }, (_, k) => `11.${k + 1}`), "12.0", ...Array.from({ length: b }, (_, k) => `12.${k + 1}`)].join(" "));
    }
  }
});

const RUNS: SessionRun[] = [
  { row: 11, exerciseId: 2, variantId: null, rows: [11], sets: 3 },
  { row: 12, exerciseId: 3, variantId: 7, rows: [12], sets: 3 },
];
const dec = (date: string, paired: boolean): PairDecision => ({ date, session: 1, rowA: 30, rowB: 31, exerciseA: 2, variantA: null, exerciseB: 3, variantB: 7, paired, updatedAt: `${date}T08:00:00Z` });

test("S-b: the latest earlier row decides regardless of input order", () => {
  assert.deepEqual(effectivePairs(RUNS, [], [dec("2026-10-05", false), dec("2026-10-01", true)]), []);
  assert.deepEqual(effectivePairs(RUNS, [], [dec("2026-10-08", true), dec("2026-10-05", false)]), [{ rowA: 11, rowB: 12, source: "suggested" }]);
  assert.deepEqual(effectivePairs(RUNS, [], [dec("2026-10-01", false), dec("2026-10-08", true), dec("2026-10-05", false)]), [{ rowA: 11, rowB: 12, source: "suggested" }]);
});

// --- fake PostgREST (as supersets.test.ts), recording request bodies -----------------------------
type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; requests: number; failAt?: number; writes: number; bodies: Row[] };
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
function fakeDb(sheet: [number, number, string][] = [[10, 2, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"], [13, 1, "Dips"]]): FakeDb {
  const names = [...new Set(sheet.map((s) => s[2]))];
  return {
    tables: {
      strength_sets: sheet.flatMap(([sheet_row, n, name]) => Array.from({ length: n }, (_, k) => ({ week_start: "2026-10-12", session: 1, sheet_row, set_no: k + 1, name, reps_text: "3", variant_id: null }))),
      exercises: names.map((name, i) => ({ id: i + 1, name, aliases: [] })),
      exercise_set_log: [],
      session_order: [],
      superset_pairs: [],
    },
    requests: 0,
    writes: 0,
    bodies: [],
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
    db.bodies.push(body);
    if (method === "POST" && table === "superset_pairs") {
      const hit = rows.find((r) => ["date", "session_no", "row_a"].every((k) => r[k] === body[k]));
      if (hit === undefined) rows.push({ ...body });
      else Object.assign(hit, body);
    } else if (method === "POST") {
      const pk = ["date", "session_no", "row_no", "set_no"];
      if (!rows.some((r) => pk.every((k) => r[k] === body[k]))) rows.push({ started_at: null, ended_at: null, skipped: false, felt_rpe: null, reps_done: null, ...body });
    } else if (method === "PATCH") {
      for (const r of rows.filter((x) => matches(x, parsed.searchParams))) Object.assign(r, body);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}
const NOW = new Date("2026-10-12T08:00:00.000Z");
const at = (m: number) => new Date(NOW.getTime() + m * 60_000);
const opts = (db: FakeDb, env: Record<string, string> = {}, nodeEnv = "production"): SupersetOptions => ({ env, nodeEnv, client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) });
const pairInput = (paired: boolean, rowA = 11, rowB = 12): SupersetInput => ({ date: "2026-10-12", sessionNo: 1, rowA, rowB, paired });
const logRow = (row_no: number, set_no: number, extra: Row = {}): Row => ({ date: "2026-10-12", session_no: 1, row_no, set_no, kind: set_no === 0 ? "warmup" : "set", started_at: NOW.toISOString(), ended_at: null, skipped: false, updated_at: NOW.toISOString(), felt_rpe: null, reps_done: null, ...extra });
const tap = (kind: SetTapInput["kind"], row: number, set: number): SetTapInput => ({ kind, date: "2026-10-12", session: 1, row, set, undoes: null });
const tapOpts = (db: FakeDb) => ({ env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) });
function dbLog(db: FakeDb): Map<string, LoggedSet> {
  return new Map(db.tables.exercise_set_log.map((r) => {
    const l: LoggedSet = { row: Number(r.row_no), set: Number(r.set_no), startedAt: (r.started_at as string | null) ?? null, endedAt: (r.ended_at as string | null) ?? null, skipped: r.skipped === true, skippedAt: (r.skipped_at as string | null) ?? null, updatedAt: (r.updated_at as string | null) ?? null };
    return [setKey(l), l];
  }));
}
console.error = () => {};

test("S-c: started = any log row of either run except A's warm-up (A1, B1 skipped, B2 ended); DEV_TODAY writes nothing", async () => {
  for (const r of [logRow(11, 1), logRow(12, 1, { started_at: null, skipped: true, skipped_at: NOW.toISOString() }), logRow(12, 2, { ended_at: at(1).toISOString() })]) {
    const db = fakeDb();
    db.tables.exercise_set_log.push(r);
    assert.deepEqual(await recordSupersetPair(pairInput(true), NOW, opts(db)), { ok: false, reason: "started" }, `${r.row_no}.${r.set_no}`);
    assert.equal(db.writes, 0);
  }
  const off = fakeDb();
  off.tables.exercise_set_log.push(logRow(11, 1));
  assert.deepEqual(await recordSupersetPair(pairInput(false), NOW, opts(off)), { ok: false, reason: "started" }, "switching off is refused too");
  const dev = fakeDb();
  const r = await recordSupersetPair(pairInput(true), NOW, opts(dev, { DEV_TODAY: "2026-10-12" }, "development"));
  assert.equal(dev.writes, 0, `DEV_TODAY: ${JSON.stringify(r)}`);
});

test("S-e(2): B1's done cut at every request and retried -> B1 ended, A2 started at B1's end, spans hold", async () => {
  for (let n = 1; n <= 16; n++) {
    const db = fakeDb();
    await recordSupersetPair(pairInput(true), NOW, opts(db));
    for (const [input, m] of [[tap("begin", 11, 0), 1], [tap("done", 11, 0), 2], [tap("done", 12, 0), 3], [tap("done", 11, 1), 4]] as const) {
      assert.equal((await recordSetTap(input, at(m), tapOpts(db))).ok, true);
    }
    db.requests = 0;
    db.failAt = n;
    await recordSetTap(tap("done", 12, 1), at(5), tapOpts(db));
    db.failAt = undefined;
    assert.equal((await recordSetTap(tap("done", 12, 1), at(6), tapOpts(db))).ok, true, `split ${n}`);
    const log = dbLog(db);
    assert.ok(log.get("12#1")?.endedAt != null, `split ${n}: B1 ended`);
    assert.equal(log.get("11#2")?.startedAt, log.get("12#1")?.endedAt, `split ${n}: A2 starts at B1's end`);
    assert.equal(log.get("12#2"), undefined, `split ${n}: B2 not started`);
    for (const l of log.values()) {
      assert.ok(!(l.skipped && (l.startedAt !== null || l.endedAt !== null)), `split ${n}: skipped has no time`);
      assert.ok(l.endedAt === null || (l.startedAt !== null && Date.parse(l.endedAt) >= Date.parse(l.startedAt)), `split ${n}: span`);
    }
  }
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("S-f: for random sheets and pairs, the server starts exactly the set the client order names next", async () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rand = rng(seed);
    const nRuns = 2 + Math.floor(rand() * 3);
    const sheet: [number, number, string][] = Array.from({ length: nRuns }, (_, i) => [10 + i, 1 + Math.floor(rand() * 4), `Ex${i}`]);
    const k = Math.floor(rand() * (nRuns - 1));
    const db = fakeDb(sheet);
    assert.equal((await recordSupersetPair(pairInput(true, 10 + k, 11 + k), NOW, opts(db))).ok, true, `seed ${seed}`);
    const exercises = sheet.map(([r, n, name]) => ({ name, variant: null, variantId: null, row: r, sets: Array.from({ length: n }, (_, j) => ({ row: r, set: j + 1 })) }));
    const order = clientOrder(exercises, [{ rowA: 10 + k, rowB: 11 + k }]);
    assert.equal((await recordSetTap(tap("begin", order[0].row, 0), at(0), tapOpts(db))).ok, true);
    for (let i = 0; i < order.length; i++) {
      const kind = rand() < 0.2 && order[i].set !== 0 ? "skip" : "done";
      assert.equal((await recordSetTap(tap(kind, order[i].row, order[i].set), at(i + 1), tapOpts(db))).ok, true, `seed ${seed} ${kind} ${show([order[i]])}`);
      const log = dbLog(db);
      const started = [...log.values()].filter((l) => l.startedAt !== null && l.endedAt === null && !l.skipped).map((l) => `${l.row}.${l.set}`);
      assert.deepEqual(started, i + 1 < order.length ? [show([order[i + 1]])] : [], `seed ${seed} after ${show([order[i]])}`);
    }
  }
});

test("F-c: a done with no feel tap writes no felt_rpe and leaves it null", async () => {
  const db = fakeDb();
  for (const [input, m] of [[tap("begin", 10, 0), 1], [tap("done", 10, 0), 2], [tap("done", 10, 1), 3], [tap("done", 10, 2), 4]] as const) {
    assert.equal((await recordSetTap(input, at(m), tapOpts(db))).ok, true);
  }
  assert.ok(db.bodies.every((b) => b.felt_rpe === undefined || b.felt_rpe === null), JSON.stringify(db.bodies));
  assert.ok(db.tables.exercise_set_log.every((r) => r.felt_rpe === null));
});

test("F-e: the same log gives the same Fokus view (a reload), also with a pair hand-off", () => {
  const exercises = [
    { name: "Bench", variant: null, variantId: null, row: 10, sets: [1, 2, 3].map((s) => ({ row: 10, set: s })), restMinS: 90, restMaxS: 180 },
    { name: "Pull-ups", variant: null, variantId: null, row: 11, sets: [1, 2, 3].map((s) => ({ row: 11, set: s })), restMinS: 180, restMaxS: 300 },
  ];
  const pairs = [{ rowA: 10, rowB: 11 }];
  const order = clientOrder(exercises, pairs);
  const handOff = (a: SetRef, b: SetRef) => pairHandOff(exercises, pairs, a, b);
  for (let n = 0; n <= order.length; n++) {
    const log = new Map<string, LoggedSet>();
    order.slice(0, n).forEach((ref, i) => {
      const t = at(i).toISOString();
      log.set(setKey(ref), { ...ref, startedAt: t, endedAt: t, skipped: false, skippedAt: null, updatedAt: t });
    });
    const reloaded = new Map(JSON.parse(JSON.stringify([...log])) as [string, LoggedSet][]);
    assert.deepEqual(fokusState(order, reloaded, handOff), fokusState(order, log, handOff), `after ${n}`);
    const v = fokusState(order, log, handOff);
    if (v.kind === "set" && v.rest !== null) assert.equal(v.showRest, !(v.rest.after.row === 10 && v.next.row === 11), `rest strip after ${n}`);
  }
});
