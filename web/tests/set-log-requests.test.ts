/**
 * The server's exact requests per tap (cleanup step 2, slice tap-transition; reviewer 2026-10-16):
 * method, table, query and body of every PostgREST call recordSetTap makes, for each tap kind,
 * warm-ups, a superset pair, refusals and a retry after the connection is cut at each request.
 * Recorded on the code before the shared transition (f0cdec8), so a refactor that keeps the end
 * state but changes the requests (an order, a guard) fails here. Synthetic data only.
 * REGENERATE_SETLOG_REQUESTS=1 pnpm test rewrites fixtures/set-log-requests.json.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { recordSetTap, type RecordOptions } from "../src/lib/db/set-log.ts";
import type { SetTapInput } from "../src/lib/set-taps.ts";

type Row = Record<string, unknown>; // a fake PostgREST row: any column, checked per test
type Request = { readonly method: string; readonly table: string; readonly query: readonly (readonly [string, string])[]; readonly body: unknown };
type Db = { tables: Record<string, Row[]>; requests: Request[]; cutAt: number | null };

const FIXTURE = new URL("./fixtures/set-log-requests.json", import.meta.url);
const DATE = "2026-10-12";
const MORNING = Date.parse("2026-10-12T08:00:00.000Z"); // 10:00 in Copenhagen
const at = (m: number) => new Date(MORNING + m * 60_000);

function freshDb(pairs: readonly Row[] = []): Db {
  // Squat row 25 (2 sets), Dip row 26 (2 sets), Facepulls row 27 (2 sets, a range: reps done default to 30)
  const sheet: [number, number, string, string][] = [
    [25, 1, "Squat", "3"],
    [25, 2, "Squat", "3"],
    [26, 1, "Dip", "8"],
    [26, 2, "Dip", "8"],
    [27, 1, "Facepulls", "20 - 30"],
    [27, 2, "Facepulls", "20 - 30"],
  ];
  return {
    tables: {
      strength_sets: sheet.map(([sheet_row, set_no, name, reps_text]) => ({
        week_start: DATE,
        session: 1,
        sheet_row,
        set_no,
        name,
        reps_text,
        variant_id: null,
      })),
      exercises: [
        { id: 1, name: "Squat", aliases: [] },
        { id: 2, name: "Dips", aliases: ["Dip"] },
        { id: 3, name: "Facepulls", aliases: [] },
      ],
      exercise_set_log: [],
      session_order: [], // a jump's order (slice fokus-sheet): read on every tap, written by a jump only
      superset_pairs: pairs.map((p) => ({ ...p })),
    },
    requests: [],
    cutAt: null,
  };
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expr] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expr.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null" && row[column] !== null && row[column] !== undefined) return false;
    if (op === "is" && value === "false" && row[column] !== false) return false;
    if (op === "eq" && String(row[column]) !== value) return false;
    if (op === "lte" && !(String(row[column]) <= value)) return false;
    if (op === "lt" && !(String(row[column]) < value)) return false;
    if (op === "gte" && !(String(row[column]) >= value)) return false;
    if (op === "in" && !value.replace(/^\(|\)$/g, "").split(",").includes(String(row[column]))) return false;
  }
  return true;
}

/** The table's check exercise_set_log_skipped_at (migration 20261016090000): a skip time exactly on a skipped set. */
function checked(r: Row): boolean {
  return (r.skipped === true) === ((r.skipped_at ?? null) !== null);
}

function fetchFor(db: Db): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    const method = init.method ?? "GET";
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const query = [...parsed.searchParams].toSorted((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    db.requests.push({ method, table, query, body });
    if (db.cutAt !== null && db.requests.length >= db.cutAt) throw new TypeError("fetch failed"); // the connection is cut
    const rows = db.tables[table] ?? [];
    if (method === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      const range = found.length ? `0-${found.length - 1}/${found.length}` : "*/0";
      return new Response(JSON.stringify(found), { headers: { "Content-Range": range } });
    }
    const item = (body ?? {}) as Row; // the write's body: one row
    if (method === "POST" && table === "session_order") {
      // One row per (date, session_no), upserted with merge-duplicates.
      db.tables[table] = [...rows.filter((r) => !(r.date === item.date && r.session_no === item.session_no)), item];
    } else if (method === "POST") {
      const key = ["date", "session_no", "row_no", "set_no"];
      if (!rows.some((r) => key.every((k) => r[k] === item[k]))) {
        const row = { started_at: null, ended_at: null, skipped: false, felt_rpe: null, reps_done: null, ...item };
        if (!checked(row)) return new Response("{}", { status: 400 });
        rows.push(row);
      }
    } else if (method === "PATCH") {
      const hit = rows.filter((r) => matches(r, parsed.searchParams));
      if (hit.some((r) => !checked({ ...r, ...item }))) return new Response("{}", { status: 400 }); // atomic, as Postgres
      for (const r of hit) Object.assign(r, item);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

function options(db: Db): RecordOptions {
  return { env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) };
}

type Step = { readonly kind: SetTapInput["kind"]; readonly row: number; readonly set: number; readonly m: number; readonly more?: Partial<SetTapInput> };

function input(s: Step): SetTapInput {
  return { kind: s.kind, date: DATE, session: 1, row: s.row, set: s.set, undoes: null, ...s.more };
}

const step = (kind: Step["kind"], row: number, set: number, m: number, more?: Partial<SetTapInput>): Step => ({ kind, row, set, m, more });

const PAIR = { date: DATE, session_no: 1, row_a: 25, row_b: 26, exercise_a: 1, variant_a: null, exercise_b: 2, variant_b: null, paired: true, updated_at: "2026-10-12T07:00:00.000Z" };

/** Scenarios: name, the superset pairs, the taps. Each records the requests and result of every tap. */
const SCENARIOS: readonly { readonly name: string; readonly pairs: readonly Row[]; readonly steps: readonly Step[] }[] = [
  {
    name: "a whole session with warm-ups, a skip, a range set with feel and reps",
    pairs: [],
    steps: [
      step("begin", 25, 0, 0),
      step("done", 25, 0, 2),
      step("done", 25, 1, 5),
      step("done", 25, 2, 9),
      step("done", 26, 0, 10),
      step("skip", 26, 1, 11),
      step("done", 26, 2, 14),
      step("done", 27, 0, 15),
      step("done", 27, 1, 17),
      step("feel", 27, 1, 18, { value: 1 }),
      step("reps", 27, 1, 18, { value: 25 }),
      step("done", 27, 2, 21),
    ],
  },
  {
    name: "undo of each kind",
    pairs: [],
    steps: [
      step("begin", 25, 0, 0),
      step("undo", 25, 0, 1, { undoes: "begin" }),
      step("begin", 25, 0, 2),
      step("done", 25, 0, 3),
      step("done", 25, 1, 6),
      step("undo", 25, 1, 7, { undoes: "done" }),
      step("done", 25, 1, 8),
      step("skip", 25, 2, 9),
      step("undo", 25, 2, 10, { undoes: "skip" }),
      step("skip", 25, 2, 11),
    ],
  },
  {
    name: "refused or odd taps",
    pairs: [],
    steps: [
      step("done", 99, 1, 0),
      step("reps", 27, 1, 1, { value: 25 }),
      step("undo", 25, 1, 2, { undoes: "done" }),
      step("begin", 25, 0, 3),
      step("begin", 25, 0, 4),
      step("done", 27, 2, 5),
      step("reps", 27, 2, 6, { value: 99 }),
    ],
  },
  {
    name: "a superset pair: warm-ups alone, then A1 B1 A2 B2",
    pairs: [PAIR],
    steps: [
      step("begin", 25, 0, 0),
      step("done", 25, 0, 2),
      step("done", 26, 0, 3),
      step("done", 25, 1, 6),
      step("done", 26, 1, 7),
      step("done", 25, 2, 10),
      step("skip", 26, 2, 11),
      step("done", 27, 0, 12),
    ],
  },
  // Slice fokus-sheet: the jump (new keys only; every scenario above is unchanged).
  {
    name: "jump: after B1 to C, C's sets, then B2",
    pairs: [],
    steps: [
      step("begin", 25, 0, 0),
      step("done", 25, 0, 2),
      step("done", 25, 1, 5),
      step("done", 25, 2, 9),
      step("done", 26, 0, 10),
      step("done", 26, 1, 13),
      step("jump", 27, 1, 14),
      step("jump", 27, 1, 15),
      step("done", 27, 0, 16),
      step("done", 27, 1, 18),
      step("done", 27, 2, 21),
      step("done", 26, 2, 24),
    ],
  },
  {
    name: "jump: right after Begynd, then back",
    pairs: [],
    steps: [step("begin", 25, 0, 0), step("jump", 26, 1, 1), step("done", 26, 0, 3), step("jump", 25, 1, 4), step("done", 25, 0, 6)],
  },
  {
    name: "jump: refused (a done run, a row of no run) and in a pair",
    pairs: [PAIR],
    steps: [
      step("begin", 25, 0, 0),
      step("jump", 99, 1, 1),
      step("jump", 27, 1, 2),
      step("done", 27, 0, 3),
      step("done", 27, 1, 5),
      step("done", 27, 2, 7),
      step("jump", 27, 1, 8),
      step("jump", 26, 1, 9),
    ],
  },
  // Slice jump-undo (user 2026-10-17): Fortryd of a jump or a chain (new keys only).
  ...JUMP_UNDO_SCENARIOS(),
];

/** Fortryd of a jump: Fokus sends undoes "jump" with the jumped_at it saw (the jump's T). */
function undoJump(m: number, jumpM: number): Step {
  return step("undo", 27, 0, m, { undoes: "jump", seen: at(jumpM).toISOString() });
}

function JUMP_UNDO_SCENARIOS(): { readonly name: string; readonly pairs: readonly Row[]; readonly steps: readonly Step[] }[] {
  const squat1 = [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5)];
  return [
    {
      name: "jump undo: jump, Fortryd (the order and the start back), Fortryd again (nothing), go on",
      pairs: [],
      steps: [...squat1, step("jump", 27, 1, 6), undoJump(7, 6), undoJump(8, 6), step("done", 25, 2, 9)],
    },
    {
      name: "jump undo: a chain of two jumps, one Fortryd",
      pairs: [],
      steps: [...squat1, step("jump", 26, 1, 6), step("undo", 26, 0, 7, { undoes: "jump", seen: at(6).toISOString() }), step("jump", 26, 1, 8), step("jump", 27, 1, 9), undoJump(10, 9)],
    },
    {
      name: "jump undo: a done after the jump, Fortryd undoes the done, a stale jump undo is refused, then the jump",
      pairs: [],
      steps: [...squat1, step("jump", 27, 1, 6), step("done", 27, 0, 7), undoJump(8, 6), step("undo", 27, 0, 9, { undoes: "done" }), undoJump(10, 6)],
    },
  ];
}

/** The cut scenario: replay up to `cut` taps, cut the connection at request k of the next one, then retry it. */
const CUTS: readonly { readonly name: string; readonly pairs: readonly Row[]; readonly before: readonly Step[]; readonly tap: Step }[] = [
  { name: "done 25#1", pairs: [], before: [step("begin", 25, 0, 0), step("done", 25, 0, 2)], tap: step("done", 25, 1, 5) },
  { name: "done on a range set 27#1", pairs: [], before: [step("begin", 27, 0, 0), step("done", 27, 0, 1)], tap: step("done", 27, 1, 3) },
  { name: "skip 25#2", pairs: [], before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5)], tap: step("skip", 25, 2, 6) },
  { name: "undo skip 25#2", pairs: [], before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5), step("skip", 25, 2, 6)], tap: step("undo", 25, 2, 7, { undoes: "skip" }) },
  { name: "done on a skipped set 25#2", pairs: [], before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5), step("skip", 25, 2, 6)], tap: step("done", 25, 2, 8) },
  { name: "undo done 25#1", pairs: [], before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5)], tap: step("undo", 25, 1, 6, { undoes: "done" }) },
  { name: "A1's done in a pair", pairs: [PAIR], before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 26, 0, 3)], tap: step("done", 25, 1, 6) },
  {
    name: "jump after B1 to C",
    pairs: [],
    before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5), step("done", 25, 2, 9), step("done", 26, 0, 10), step("done", 26, 1, 13)],
    tap: step("jump", 27, 1, 14),
  },
  { name: "jump right after Begynd", pairs: [], before: [step("begin", 25, 0, 0)], tap: step("jump", 26, 1, 1) },
  // Slice jump-undo: Fortryd of a jump and of a chain, cut at every request.
  {
    name: "undo of a jump after Squat 1",
    pairs: [],
    before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5), step("jump", 27, 1, 6)],
    tap: undoJump(7, 6),
  },
  {
    name: "undo of a chain of two jumps",
    pairs: [],
    before: [step("begin", 25, 0, 0), step("done", 25, 0, 2), step("done", 25, 1, 5), step("jump", 26, 1, 6), step("jump", 27, 1, 7)],
    tap: undoJump(8, 7),
  },
];

type Record_ = { readonly tap: string; readonly result: unknown; readonly requests: readonly Request[] };

async function run(db: Db, s: Step): Promise<Record_> {
  db.requests = [];
  let result: unknown;
  try {
    result = await recordSetTap(input(s), at(s.m), options(db));
  } catch (error) {
    result = { threw: String(error) };
  }
  return { tap: `${s.kind} ${s.row}#${s.set} @${s.m}`, result, requests: db.requests };
}

async function record(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const sc of SCENARIOS) {
    const db = freshDb(sc.pairs);
    const taps: Record_[] = [];
    for (const s of sc.steps) taps.push(await run(db, s));
    out[sc.name] = sc.steps.some((s) => s.kind === "jump") ? { taps, log: db.tables.exercise_set_log, order: db.tables.session_order } : { taps, log: db.tables.exercise_set_log };
  }
  for (const c of CUTS) {
    const db0 = freshDb(c.pairs);
    for (const s of c.before) await run(db0, s);
    const n = (await run(structuredClone(db0), c.tap)).requests.length; // how many requests the tap makes
    const cuts: unknown[] = [];
    for (let k = 1; k <= n; k += 1) {
      const db = structuredClone(db0);
      db.cutAt = k;
      const cut = await run(db, c.tap);
      db.cutAt = null;
      const retry = await run(db, c.tap);
      cuts.push(c.tap.kind === "jump" || c.tap.more?.undoes === "jump" ? { k, cut, retry, log: db.tables.exercise_set_log, order: db.tables.session_order } : { k, cut, retry, log: db.tables.exercise_set_log });
    }
    out[`cut: ${c.name}`] = cuts;
  }
  return out;
}

test("recordSetTap sends exactly the recorded requests for every tap, cut and retry", async () => {
  const got = JSON.parse(JSON.stringify(await record())) as unknown;
  if (process.env.REGENERATE_SETLOG_REQUESTS === "1") {
    writeFileSync(FIXTURE, `${JSON.stringify(got, null, 1)}\n`);
    return;
  }
  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown;
  assert.deepEqual(got, expected);
});

test("a jump cut at every request, then retried, ends as the uncut jump (log and order)", async () => {
  for (const c of CUTS.filter((x) => x.tap.kind === "jump")) {
    const db0 = freshDb(c.pairs);
    for (const s of c.before) await run(db0, s);
    const whole = structuredClone(db0);
    const n = (await run(whole, c.tap)).requests.length;
    assert.ok(n > 0);
    for (let k = 1; k <= n; k += 1) {
      const db = structuredClone(db0);
      db.cutAt = k;
      await run(db, c.tap);
      db.cutAt = null;
      assert.deepEqual((await run(db, c.tap)).result, { ok: true, at: at(c.tap.m).toISOString() }, `${c.name} cut ${k}`);
      assert.deepEqual(db.tables.exercise_set_log, whole.tables.exercise_set_log, `${c.name} cut ${k}: log`);
      assert.deepEqual(db.tables.session_order, whole.tables.session_order, `${c.name} cut ${k}: order`);
    }
  }
});

/** The screens' state of a table: every set's times (not updated_at), and the order with its undo mark. */
function state(db: Db) {
  const log = db.tables.exercise_set_log
    .map((r) => [r.row_no, r.set_no, r.started_at, r.ended_at, r.skipped, r.skipped_at ?? null, r.felt_rpe, r.reps_done])
    .toSorted((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
  const o = db.tables.session_order.at(0);
  // No row and the sheet's runs are the same order.
  const order = o === undefined ? [25, 26, 27] : o.run_rows;
  return { log, order, mark: o === undefined ? null : [o.previous_rows ?? null, o.jumped_at ?? null, o.moved_start ?? null] };
}

test("Fortryd of a jump (or a chain) cut at every request, then retried, is the state before the jump", async () => {
  for (const c of CUTS.filter((x) => x.tap.more?.undoes === "jump")) {
    const db0 = freshDb(c.pairs);
    const firstJump = c.before.findIndex((s) => s.kind === "jump");
    for (const s of c.before.slice(0, firstJump)) await run(db0, s);
    const beforeJump = state(db0);
    for (const s of c.before.slice(firstJump)) await run(db0, s);
    const n = (await run(structuredClone(db0), c.tap)).requests.length;
    assert.ok(n > 0);
    for (let k = 1; k <= n; k += 1) {
      const db = structuredClone(db0);
      db.cutAt = k;
      await run(db, c.tap);
      db.cutAt = null;
      assert.deepEqual((await run(db, c.tap)).result, { ok: true, at: at(c.tap.m).toISOString() }, `${c.name} cut ${k}`);
      assert.deepEqual(state(db), { ...beforeJump, mark: [null, null, null] }, `${c.name} cut ${k}: state`);
      const again = await run(db, c.tap); // once the mark has landed, a retry writes nothing
      assert.deepEqual(again.requests.filter((r) => r.method !== "GET"), [], `${c.name} cut ${k}: a late retry`);
    }
  }
});
