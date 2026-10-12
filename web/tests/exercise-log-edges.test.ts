import assert from "node:assert/strict";
import { test } from "node:test";

import { recordTap, type RecordOptions } from "../src/lib/db/exercise-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { tapChange, type TapInput } from "../src/lib/exercise-taps.ts";

// Tester's edge cases for slice exercise-log (B2-B5): exercises that appear twice in a session,
// unticking a middle row, the last exercise, a session with no sheet rows, a server clock that
// goes backwards, and an undo after a reload.

const ticked = (...keys: string[]) => (key: string) => keys.includes(key);

// --- tapChange --------------------------------------------------------------------------------

// Squat appears twice, with Bænk between: one exercise (one exercise_log row) in two runs.
const SPLIT = [
  { key: "a", name: "Squat" },
  { key: "b", name: "Squat" },
  { key: "c", name: "Bænk" },
  { key: "d", name: "Squat" },
  { key: "e", name: "Dips" },
];

test("tapChange: an exercise in two non-adjacent runs ends only when its very last row is ticked", () => {
  assert.equal(tapChange(SPLIT, ticked(), "a", true)?.kind, "start");
  assert.equal(tapChange(SPLIT, ticked("a"), "b", true), null); // its first run done, Squat is not
  // Bænk's next is the row after Bænk's last row: the second Squat run.
  assert.deepEqual(tapChange(SPLIT, ticked("a", "b"), "c", true), {
    kind: "end",
    exercise: "Bænk",
    next: "Squat",
  });
  assert.deepEqual(tapChange(SPLIT, ticked("a", "b", "c"), "d", true), {
    kind: "end",
    exercise: "Squat",
    next: "Dips",
  });
  // Ticking the second run first: the first tick of Squat anywhere is its start.
  assert.equal(tapChange(SPLIT, ticked(), "d", true)?.kind, "start");
  // undo-start of the second-run-only tick names the row before Squat's FIRST row: none.
  assert.deepEqual(tapChange(SPLIT, ticked("d"), "d", false), {
    kind: "undo-start",
    exercise: "Squat",
    next: null,
  });
});

test("tapChange: unticking a middle row undoes the end of a done exercise, else is no tap", () => {
  const rows = [
    { key: "a", name: "Squat" },
    { key: "b", name: "Squat" },
    { key: "c", name: "Squat" },
    { key: "d", name: "Dips" },
  ];
  assert.deepEqual(tapChange(rows, ticked("a", "b", "c"), "b", false), {
    kind: "undo-end",
    exercise: "Squat",
    next: "Dips",
  });
  assert.equal(tapChange(rows, ticked("a", "b"), "b", false), null);
  // Ticks out of order: the last row first is a start, the completing middle row is the end.
  assert.equal(tapChange(rows, ticked(), "c", true)?.kind, "start");
  assert.equal(tapChange(rows, ticked("a", "c"), "b", true)?.kind, "end");
});

test("tapChange: the last exercise's end and undo name no next exercise", () => {
  const rows = [
    { key: "a", name: "Dips" },
    { key: "b", name: "Facepulls" },
    { key: "c", name: "facepulls" },
  ];
  assert.deepEqual(tapChange(rows, ticked("b"), "c", true), {
    kind: "end",
    exercise: "facepulls",
    next: null,
  });
  assert.equal(tapChange(rows, ticked("b", "c"), "b", false)?.next, null);
});

// --- recordTap against an in-memory PostgREST that enforces exercise_log's checks --------------

type Row = Record<string, unknown>;
type FakeDb = { readonly tables: Record<string, Row[]>; readonly calls: string[] };

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null" && row[column] !== null) return false;
    if (op === "eq" && String(row[column]) !== value) return false;
  }
  return true;
}

/** check (started_at is null or ended_at is null or ended_at >= started_at) */
function valid(row: Row): boolean {
  const s = row.started_at;
  const e = row.ended_at;
  return s === null || e === null || Date.parse(String(e)) >= Date.parse(String(s));
}

function fakeDb(): FakeDb {
  return {
    tables: {
      strength_sets: [
        { week_start: "2026-10-12", session: 1, name: "Squat" },
        { week_start: "2026-10-12", session: 1, name: "Squat" },
        { week_start: "2026-10-12", session: 1, name: "Bænk" },
        { week_start: "2026-10-12", session: 1, name: "Squat" },
        { week_start: "2026-10-12", session: 1, name: "Dips" },
      ],
      exercises: [
        { id: 1, name: "Squat", aliases: [] },
        { id: 2, name: "Bænk", aliases: [] },
        { id: 3, name: "Dips", aliases: [] },
      ],
      exercise_log: [],
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
    const rows = db.tables[table];
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : {};
    if (method === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows
        .filter((r) => matches(r, parsed.searchParams))
        .map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      const range = found.length ? `0-${found.length - 1}/${found.length}` : "*/0";
      return new Response(JSON.stringify(found), { headers: { "Content-Range": range } });
    }
    if (method === "POST") {
      const key = ["date", "session_no", "exercise_id"];
      if (!rows.some((r) => key.every((k) => r[k] === body[k]))) {
        const row = { started_at: null, ended_at: null, ...body };
        if (!valid(row)) return new Response("{}", { status: 400 });
        rows.push(row);
      }
    } else if (method === "PATCH") {
      const hit = rows.filter((r) => matches(r, parsed.searchParams));
      if (!hit.every((r) => valid({ ...r, ...body }))) return new Response("{}", { status: 400 });
      for (const r of hit) Object.assign(r, body);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

const MORNING = new Date("2026-10-12T08:00:00.000Z");
const at = (minutes: number) => new Date(MORNING.getTime() + minutes * 60_000);
const iso = (minutes: number) => at(minutes).toISOString();

function options(db: FakeDb): RecordOptions {
  return {
    env: {},
    nodeEnv: "production",
    client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)),
  };
}

function tap(kind: TapInput["kind"], exercise: string, more: Partial<TapInput> = {}): TapInput {
  return { kind, exercise, next: null, date: "2026-10-12", session: 1, at: null, ...more };
}

function log(db: FakeDb): Array<[unknown, unknown, unknown]> {
  return db.tables.exercise_log.map((r) => [r.exercise_id, r.started_at, r.ended_at]);
}

test("recordTap: a split exercise keeps one row; its end comes from its last run", async () => {
  const db = fakeDb();
  await recordTap(tap("start", "Squat"), at(0), options(db));
  await recordTap(tap("end", "Bænk", { next: "Squat" }), at(5), options(db)); // Squat already started
  await recordTap(tap("end", "Squat", { next: "Dips" }), at(10), options(db));
  assert.deepEqual(log(db), [
    [1, iso(0), iso(10)],
    [2, iso(5), iso(5)],
    [3, iso(10), null],
  ]);
  assert.ok(db.tables.exercise_log.every(valid));
});

test("recordTap: the last exercise's end touches only its own row", async () => {
  const db = fakeDb();
  await recordTap(tap("start", "Dips"), at(0), options(db));
  const before = db.calls.length;
  assert.deepEqual(await recordTap(tap("end", "Dips"), at(4), options(db)), { ok: true, at: iso(4) });
  assert.deepEqual(log(db), [[3, iso(0), iso(4)]]);
  // One POST + one PATCH per field (started_at, ended_at) for Dips; nothing for another exercise.
  const writes = db.calls.slice(before).filter((c) => !c.startsWith("GET"));
  assert.deepEqual(writes, ["POST exercise_log", "PATCH exercise_log", "PATCH exercise_log"]);
});

test("recordTap: a session number with no sheet rows is refused, nothing written", async () => {
  const db = fakeDb();
  for (const session of [2, 14]) {
    assert.deepEqual(await recordTap(tap("start", "Squat", { session }), at(0), options(db)), {
      ok: false,
      reason: "invalid",
    });
  }
  assert.deepEqual(log(db), []);
  assert.ok(db.calls.every((c) => c.startsWith("GET")));
});

test("recordTap: a date that is not a real day is refused before any request", async () => {
  const db = fakeDb();
  for (const date of ["2026-02-30", "2026-13-01", "0000-00-00"]) {
    assert.deepEqual(await recordTap(tap("start", "Squat", { date }), at(0), options(db)), {
      ok: false,
      reason: "invalid",
    });
  }
  assert.deepEqual(db.calls, []);
});

test("recordTap: a server clock that goes backwards is reported as not saved, never thrown", async () => {
  const db = fakeDb();
  await recordTap(tap("start", "Dips"), at(10), options(db));
  // Another server instance whose clock is 2 minutes behind: ended_at < started_at is refused.
  const result = await recordTap(tap("end", "Dips"), at(8), options(db));
  assert.deepEqual(result, { ok: false, reason: "failed" });
  assert.ok(db.tables.exercise_log.every(valid));
});

test("recordTap: undo of a re-tick after a reload leaves the first tick's timing alone (B3 + B4)", async () => {
  const db = fakeDb();
  // Dips is one row: its tick wrote both its start and its end at 0.
  assert.deepEqual(await recordTap(tap("end", "Dips"), at(0), options(db)), { ok: true, at: iso(0) });
  // Reload: the tick and its returned timestamp are gone. The user ticks Dips again: it writes
  // nothing (first write wins), so the server returns no timestamp and the client has no undo.
  assert.deepEqual(await recordTap(tap("end", "Dips"), at(30), options(db)), { ok: true, at: null });
  assert.deepEqual(log(db), [[3, iso(0), iso(0)]]);
  // Even an undo carrying the re-tick's own time clears nothing: no field holds it.
  await recordTap(tap("undo-end", "Dips", { at: iso(30) }), at(31), options(db));
  assert.deepEqual(log(db), [[3, iso(0), iso(0)]]);
});
