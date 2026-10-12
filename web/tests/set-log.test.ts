import assert from "node:assert/strict";
import { test } from "node:test";

import { recordSetTap, type RecordOptions } from "../src/lib/db/set-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import {
  applyTap,
  firstOpen,
  type LoggedSet,
  parseSetTapInput,
  progress,
  restStart,
  sessionOrder,
  setKey,
  type SetTapInput,
  stateOf,
  lastTap,
} from "../src/lib/set-taps.ts";

// --- pure rules ------------------------------------------------------------------------------

// Squat: row 25 with 2 sets, then Dips: row 26 with 1 set, then Facepulls: row 27 with 2 sets.
const ORDER = sessionOrder([
  { row: 27, set: 2 },
  { row: 25, set: 1 },
  { row: 26, set: 1 },
  { row: 25, set: 2 },
  { row: 27, set: 1 },
]);
const T = (m: number) => new Date(Date.UTC(2026, 9, 12, 8, m)).toISOString();
const empty = new Map<string, LoggedSet>();

function apply(log: ReadonlyMap<string, LoggedSet>, kind: SetTapInput["kind"], row: number, set: number, m: number) {
  return applyTap(ORDER, log, kind, { row, set }, T(m));
}

function view(log: ReadonlyMap<string, LoggedSet>): Array<[string, string | null, string | null, boolean]> {
  return [...log.values()]
    .toSorted((a, b) => a.row - b.row || a.set - b.set)
    .map((l) => [setKey(l), l.startedAt, l.endedAt, l.skipped]);
}

test("sessionOrder: rows by sheet row, sets 1..n; firstOpen and progress follow it", () => {
  assert.deepEqual(ORDER.map(setKey), ["25#1", "25#2", "26#1", "27#1", "27#2"]);
  assert.deepEqual(firstOpen(ORDER, empty), { row: 25, set: 1 });
  assert.deepEqual(progress(ORDER, empty), { done: 0, skipped: 0, total: 5 });
});

test("applyTap: begin starts set 1; done ends it and starts the next; skip leaves no times", () => {
  let log = apply(empty, "begin", 25, 1, 0);
  log = apply(log, "done", 25, 1, 2);
  log = apply(log, "done", 25, 2, 5);
  log = apply(log, "skip", 26, 1, 6);
  assert.deepEqual(view(log), [
    ["25#1", T(0), T(2), false],
    ["25#2", T(2), T(5), false],
    ["26#1", null, null, true],
    ["27#1", T(6), null, false],
  ]);
  assert.deepEqual(progress(ORDER, log), { done: 2, skipped: 1, total: 5 });
  assert.equal(stateOf(log.get("26#1")), "skipped");
  assert.equal(restStart(log), null); // the latest tap was a skip: no rest timer
  assert.equal(restStart(apply(log, "undo", 26, 1, 7)), T(5)); // back to the done before it
  assert.deepEqual(lastTap(log), { ref: { row: 26, set: 1 }, kind: "skip", at: T(6) });
  assert.deepEqual(firstOpen(ORDER, log), { row: 27, set: 1 });
  // Done twice changes nothing (first write wins).
  assert.deepEqual(view(apply(log, "done", 25, 1, 9)), view(log));
});

test("applyTap: undo clears what its tap wrote", () => {
  let log = apply(empty, "begin", 25, 1, 0);
  log = apply(log, "done", 25, 1, 2);
  log = apply(log, "done", 25, 2, 5);
  // Undo set 2: its end and the start of the next set it wrote go; its own start (set 1's end) stays.
  const undone = apply(log, "undo", 25, 2, 6);
  assert.deepEqual(view(undone), [
    ["25#1", T(0), T(2), false],
    ["25#2", T(2), null, false],
  ]);
  // Undo a skip: the set gets its start back from the previous set's end; the next set's goes.
  const skipped = apply(log, "skip", 26, 1, 7);
  assert.deepEqual(view(apply(skipped, "undo", 26, 1, 8)).slice(2), [["26#1", T(5), null, false]]);
  // Undo a begin: the row disappears.
  assert.deepEqual(view(apply(apply(empty, "begin", 25, 1, 0), "undo", 25, 1, 1)), []);
});

test("applyTap: undo keeps the start of a set that is already done; skip of a done set is refused", () => {
  let log = apply(empty, "done", 25, 1, 2);
  log = apply(log, "done", 25, 2, 5); // its start is set 1's end (T2)
  const undone = apply(log, "undo", 25, 1, 6);
  assert.deepEqual(view(undone), [
    ["25#2", T(2), T(5), false], // 25#2 keeps its real start
    ["26#1", T(5), null, false], // and Dips the start 25#2's done gave it
  ]);
  assert.deepEqual(view(apply(undone, "done", 25, 1, 7)).map((r) => r[0]), ["25#1", "25#2", "26#1"]);
  assert.deepEqual(view(apply(log, "skip", 25, 1, 8)), view(log)); // refused
});

test("applyTap: done and skip start the next OPEN set", () => {
  let log = apply(empty, "done", 26, 1, 1); // Dips first, out of order
  log = apply(log, "done", 25, 2, 3);
  assert.equal(log.get("27#1")?.startedAt, T(1)); // Dips' done started the next open set
  assert.equal(log.get("26#1")?.endedAt, T(1)); // 25#2's done didn't touch the done Dips
});

test("parseSetTapInput: exact shape only", () => {
  const ok = { kind: "done", date: "2026-10-12", session: 1, row: 25, set: 2 };
  assert.deepEqual(parseSetTapInput(ok), ok);
  for (const bad of [
    null,
    { ...ok, kind: "delete" },
    { ...ok, session: 0 },
    { ...ok, session: 15 },
    { ...ok, row: 1.5 },
    { ...ok, set: "2" },
    { ...ok, date: "12-10-2026" },
  ]) {
    assert.equal(parseSetTapInput(bad), null, JSON.stringify(bad));
  }
});

// --- recordSetTap against an in-memory PostgREST that enforces the table's checks ------------

type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; readonly calls: string[]; failWith?: number };

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null" && row[column] !== null) return false;
    if (op === "is" && value === "false" && row[column] !== false) return false;
    if (op === "eq" && String(row[column]) !== value) return false;
  }
  return true;
}

function valid(r: Row): boolean {
  const started = r.started_at as string | null;
  const ended = r.ended_at as string | null;
  if (r.skipped === true && (started !== null || ended !== null)) return false;
  return started === null || ended === null || Date.parse(ended) >= Date.parse(started);
}

function fakeDb(): FakeDb {
  const sheet = [
    [1, 25, 1, "Squat"],
    [1, 25, 2, "Squat"],
    [1, 26, 1, "Dip"], // the sheet's spelling: an alias of Dips
    [1, 27, 1, "Facepulls"],
    [2, 77, 1, "Dødløft"],
  ];
  return {
    tables: {
      strength_sets: sheet.map(([session, sheet_row, set_no, name]) => ({
        week_start: "2026-10-12",
        session,
        sheet_row,
        set_no,
        name,
      })),
      exercises: [
        { id: 1, name: "Squat", aliases: [] },
        { id: 2, name: "Dips", aliases: ["Dip"] },
        { id: 3, name: "Facepulls", aliases: [] },
        { id: 4, name: "Dødløft", aliases: [] },
      ],
      exercise_set_log: [],
    },
    calls: [],
  };
}

function fetchFor(db: FakeDb): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    const method = init.method ?? "GET";
    db.calls.push(`${method} ${table}`);
    if (db.failWith !== undefined) return new Response("{}", { status: db.failWith });
    const rows = db.tables[table];
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : {};
    if (method === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      const range = found.length ? `0-${found.length - 1}/${found.length}` : "*/0";
      return new Response(JSON.stringify(found), { headers: { "Content-Range": range } });
    }
    if (method === "POST") {
      const key = ["date", "session_no", "row_no", "set_no"];
      if (!rows.some((r) => key.every((k) => r[k] === body[k]))) {
        const row = { started_at: null, ended_at: null, skipped: false, ...body };
        if (!valid(row)) return new Response("{}", { status: 400 });
        rows.push(row);
      }
    } else if (method === "PATCH") {
      for (const r of rows) {
        if (!matches(r, parsed.searchParams)) continue;
        const after = { ...r, ...body };
        if (!valid(after)) return new Response("{}", { status: 400 }); // the table's check
        Object.assign(r, body);
      }
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

const MORNING = new Date("2026-10-12T08:00:00.000Z"); // 10:00 in Copenhagen
const at = (m: number) => new Date(MORNING.getTime() + m * 60_000);
const iso = (m: number) => at(m).toISOString();

function options(db: FakeDb, overrides: Partial<RecordOptions> = {}): RecordOptions {
  return {
    env: {},
    nodeEnv: "production",
    client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)),
    ...overrides,
  };
}

function tap(kind: SetTapInput["kind"], row: number, set: number, more: Partial<SetTapInput> = {}): SetTapInput {
  return { kind, date: "2026-10-12", session: 1, row, set, ...more };
}

function log(db: FakeDb): Array<[string, unknown, unknown, unknown, unknown]> {
  return db.tables.exercise_set_log
    .toSorted((a, b) => Number(a.row_no) - Number(b.row_no) || Number(a.set_no) - Number(b.set_no))
    .map((r) => [`${r.row_no}#${r.set_no}`, r.exercise_id, r.started_at, r.ended_at, r.skipped]);
}

test("recordSetTap: begin, done and skip write the rules; the server picks the next set", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordSetTap(tap("begin", 25, 1), at(0), options(db)), { ok: true, at: iso(0) });
  await recordSetTap(tap("done", 25, 1), at(2), options(db));
  await recordSetTap(tap("done", 25, 2), at(5), options(db));
  await recordSetTap(tap("skip", 26, 1), at(6), options(db));
  assert.deepEqual(log(db), [
    ["25#1", 1, iso(0), iso(2), false],
    ["25#2", 1, iso(2), iso(5), false],
    ["26#1", 2, null, null, true], // "Dip" resolved through its alias
    ["27#1", 3, iso(6), null, false],
  ]);
  assert.ok(db.tables.exercise_set_log.every(valid));
});

test("recordSetTap: done is idempotent; a reload reads back the same rows", async () => {
  const db = fakeDb();
  await recordSetTap(tap("done", 25, 1), at(2), options(db));
  await recordSetTap(tap("done", 25, 1), at(9), options(db));
  assert.deepEqual(log(db), [
    ["25#1", 1, iso(2), iso(2), false], // no begin: the first tap also set its start
    ["25#2", 1, iso(2), null, false],
  ]);
});

test("recordSetTap: undo clears exactly what its tap wrote", async () => {
  const db = fakeDb();
  await recordSetTap(tap("begin", 25, 1), at(0), options(db));
  await recordSetTap(tap("done", 25, 1), at(2), options(db));
  await recordSetTap(tap("done", 25, 2), at(5), options(db));
  await recordSetTap(tap("undo", 25, 2), at(6), options(db));
  assert.deepEqual(log(db), [
    ["25#1", 1, iso(0), iso(2), false],
    ["25#2", 1, iso(2), null, false], // its start was set 1's end: kept; Dips' start is gone
  ]);
  await recordSetTap(tap("skip", 25, 2), at(7), options(db));
  await recordSetTap(tap("undo", 25, 2), at(8), options(db));
  assert.deepEqual(log(db), [
    ["25#1", 1, iso(0), iso(2), false],
    ["25#2", 1, iso(2), null, false], // start restored from set 1's end; Dips' start gone again
  ]);
  await recordSetTap(tap("undo", 25, 2), at(9), options(db)); // a start set 1 wrote: kept
  assert.deepEqual(log(db).map((r) => r[0]), ["25#1", "25#2"]);
});

test("recordSetTap: undoing a set keeps the start of a later set that is done; a redo works", async () => {
  const db = fakeDb();
  await recordSetTap(tap("done", 25, 1), at(2), options(db));
  await recordSetTap(tap("done", 25, 2), at(5), options(db));
  await recordSetTap(tap("undo", 25, 1), at(6), options(db));
  assert.deepEqual(log(db).slice(0, 1), [["25#2", 1, iso(2), iso(5), false]]);
  assert.deepEqual(await recordSetTap(tap("done", 25, 1), at(7), options(db)), { ok: true, at: iso(7) });
  assert.ok(db.tables.exercise_set_log.every(valid));
  // Skipping a done set is refused: its end would be lost.
  assert.deepEqual(await recordSetTap(tap("skip", 25, 2), at(8), options(db)), { ok: false, reason: "invalid" });
});

test("recordSetTap: a set not in the session, another day, or a bad input is refused, nothing written", async () => {
  const db = fakeDb();
  const refused = { ok: false, reason: "invalid" };
  assert.deepEqual(await recordSetTap(tap("done", 77, 1), at(0), options(db)), refused); // session 2's row
  assert.deepEqual(await recordSetTap(tap("done", 25, 3), at(0), options(db)), refused); // no set 3
  assert.deepEqual(await recordSetTap(tap("done", 25, 1, { date: "2026-10-11" }), at(0), options(db)), refused);
  assert.deepEqual(log(db), []);
  assert.ok(db.calls.every((c) => c.startsWith("GET")));
});

test("recordSetTap: dev switches write nothing and read nothing; a failure is reported", async () => {
  const db = fakeDb();
  for (const env of [{ DEV_TODAY: "2026-10-09" }, { DEV_FIXTURE: "stale" }]) {
    const result = await recordSetTap(tap("done", 25, 1), at(0), options(db, { env, nodeEnv: "development" }));
    assert.deepEqual(result, { ok: false, reason: "dev" });
  }
  assert.deepEqual(db.calls, []);
  db.failWith = 500;
  assert.deepEqual(await recordSetTap(tap("done", 25, 1), at(0), options(db)), { ok: false, reason: "failed" });
});
