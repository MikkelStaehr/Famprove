import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { recordSupersetPair, type SupersetOptions } from "../src/lib/db/superset-pairs.ts";
import { parseSupersetInput, pickRunRows, runsInOrder, sessionRuns, type SupersetInput, supersetPartners } from "../src/lib/supersets.ts";

type Row = Record<string, unknown>;
type Db = { tables: Record<string, Row[]>; requests: number; failAt?: number; log: string[] };

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

function fakeDb(): Db {
  const sheet: [number, number, string][] = [[10, 2, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"], [13, 1, "Dips"], [14, 2, "Row"]];
  return {
    tables: {
      strength_sets: sheet.flatMap(([sheet_row, n, name]) =>
        Array.from({ length: n }, (_, k) => ({ week_start: "2026-10-12", session: 1, sheet_row, set_no: k + 1, name, reps_text: "3", variant_id: null })),
      ),
      exercises: sheet.map(([, , name], i) => ({ id: i + 1, name, aliases: [] })),
      exercise_set_log: [],
      session_order: [],
      superset_pairs: [],
    },
    requests: 0,
    log: [],
  };
}

function fetchFor(db: Db): FetchLike {
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
    db.log.push(`${method} ${table}`);
    const pk = table === "superset_pairs" ? ["date", "session_no", "row_a"] : ["date", "session_no"];
    const hit = rows.find((r) => pk.every((k) => r[k] === body[k]));
    if (hit === undefined) rows.push({ previous_rows: null, jumped_at: null, moved_start: null, ...body });
    else Object.assign(hit, body);
    return new Response(null, { status: 201 });
  };
}

const opts = (db: Db): SupersetOptions => ({ env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) });
const NOW = new Date("2026-10-12T08:00:00.000Z");
const input = (rowA: number, rowB: number, paired = true): SupersetInput => ({ date: "2026-10-12", sessionNo: 1, rowA, rowB, paired });
const orderOf = (db: Db) => db.tables.session_order[0]?.run_rows ?? null;
console.error = () => {};

test("P3: a pick writes session_order first and the pair last; a cut at the order write leaves no pair", async () => {
  const db = fakeDb();
  assert.equal((await recordSupersetPair(input(10, 13), NOW, opts(db))).ok, true);
  assert.deepEqual(db.log, ["POST session_order", "POST superset_pairs"]);
  // Cut exactly at each write (count the reads first), then retry.
  const reads = db.requests - 2;
  for (const cut of [reads + 1, reads + 2]) {
    const d = fakeDb();
    d.failAt = cut;
    const r = await recordSupersetPair(input(10, 13), NOW, opts(d));
    assert.equal(r.ok, false, `cut ${cut}`);
    if (cut === reads + 1) assert.equal(d.tables.superset_pairs.length, 0, "the pair is never written before the order");
    d.failAt = undefined;
    assert.deepEqual(await recordSupersetPair(input(10, 13), new Date(NOW.getTime() + 60_000), opts(d)), { ok: true, pairs: [{ rowA: 10, rowB: 13, source: "today" }], runRows: [10, 13, 11, 12, 14] });
    assert.deepEqual(orderOf(d), [10, 13, 11, 12, 14]);
  }
});

test("P2: a pick on top of a stored (jumped) order puts B right after A and the old neighbour after B", async () => {
  const db = fakeDb();
  db.tables.session_order.push({ date: "2026-10-12", session_no: 1, run_rows: [12, 10, 11, 13, 14], previous_rows: [10, 11, 12, 13, 14], jumped_at: NOW.toISOString(), moved_start: null, updated_at: NOW.toISOString() });
  const r = await recordSupersetPair(input(10, 14), NOW, opts(db));
  assert.deepEqual(r, { ok: true, pairs: [{ rowA: 10, rowB: 14, source: "today" }], runRows: [12, 10, 14, 11, 13] });
  // reload = the same state read back: the pair stays in force, no second order write.
  db.log = [];
  assert.deepEqual(await recordSupersetPair(input(10, 14), NOW, opts(db)), r);
  assert.deepEqual(db.log, ["POST superset_pairs"]);
});

test("P4: A already in a pair, or B in another pair, is refused with no write", async () => {
  const pair = (a: number, b: number, ea: number, eb: number) => ({ date: "2026-10-12", session_no: 1, row_a: a, row_b: b, exercise_a: ea, variant_a: null, exercise_b: eb, variant_b: null, paired: true, updated_at: NOW.toISOString() });
  for (const [a, b] of [[11, 14], [10, 12]] as const) {
    const db = fakeDb();
    db.tables.superset_pairs.push(pair(11, 12, 2, 3));
    assert.deepEqual(await recordSupersetPair(input(a, b), NOW, opts(db)), { ok: false, reason: "overlap" }, `${a}->${b}`);
    assert.deepEqual(db.log, []);
  }
});

test("P4: rows as text or comma decimals are refused by the action's parser", () => {
  for (const rowB of ["12", "12,0", 12.5, 0, -1]) {
    assert.equal(parseSupersetInput({ date: "2026-10-12", sessionNo: 1, rowA: 10, rowB, paired: true }), null, String(rowB));
  }
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("P1 invariant: over seeded random orders, logs and pairs, partners are exactly the unstarted, unpaired runs except A, Som sidst first", () => {
  const SPEC: [number, number, string][] = [[10, 2, "Squat"], [11, 3, "Curl"], [12, 3, "Pushdown"], [13, 1, "Dips"], [14, 2, "Row"], [15, 2, "Lunge"]];
  const SETS = SPEC.flatMap(([row, n, name]) =>
    Array.from({ length: n }, (_, k) => ({ ref: { row, set: k + 1 }, name, variantId: null })),
  );
  const ids = new Map(["squat", "curl", "pushdown", "dips", "row", "lunge"].map((n, i) => [n, i + 1]));
  const runs = sessionRuns(SETS, ids);
  const rows = runs.map((r) => r.row);
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const order = r() < 0.3 ? null : rows.toSorted(() => r() - 0.5);
    const log = SETS.filter(() => r() < 0.12).map((s) => s.ref).concat(r() < 0.3 ? [{ row: rows[Math.floor(r() * rows.length)], set: 0 }] : []);
    const pairs = r() < 0.4 ? [{ rowA: rows[Math.floor(r() * 3)], rowB: rows[3 + Math.floor(r() * 3)] }] : [];
    const a = rows[Math.floor(r() * rows.length)];
    const last = rows.filter(() => r() < 0.3);
    const got = supersetPartners(runs, order, pairs, log, a, last);
    const inPair = new Set(pairs.flatMap((p) => [p.rowA, p.rowB]));
    const startedRow = (row: number, warmupOk: boolean) => log.some((l) => runs.find((x) => x.row === row)!.rows.includes(l.row) && !(warmupOk && l.row === row && l.set === 0));
    if (inPair.has(a) || startedRow(a, true)) {
      assert.equal(got, null, `seed ${seed}`);
      continue;
    }
    const want = runsInOrder(runs, order).map((x) => x.row).filter((row) => row !== a && !inPair.has(row) && !startedRow(row, false));
    assert.notEqual(got, null, `seed ${seed}`);
    const first = last.find((row) => want.includes(row));
    const expected = first === undefined ? want : [first, ...want.filter((x) => x !== first)];
    assert.deepEqual(got!.map((p) => p.row), expected, `seed ${seed}`);
    assert.deepEqual(got!.filter((p) => p.lastTime).map((p) => p.row), first === undefined ? [] : [first], `seed ${seed}`);
    // P2: every candidate picked lands right after A; the old neighbour follows B; the rest keep their order.
    for (const b of want) {
      const before = runsInOrder(runs, order).map((x) => x.row);
      const after = pickRunRows(runs, order, a, b);
      if (before[before.indexOf(a) + 1] === b) {
        assert.equal(after, null);
        continue;
      }
      assert.deepEqual(after!.slice(after!.indexOf(a), after!.indexOf(a) + 2), [a, b], `seed ${seed} pick ${b}`);
      assert.deepEqual(after!.filter((x) => x !== b), before.filter((x) => x !== b), `seed ${seed} rest order`);
    }
  }
});
