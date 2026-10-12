import assert from "node:assert/strict";
import { test } from "node:test";

import { recordTap, type RecordOptions } from "../src/lib/db/exercise-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { parseTapInput, tapChange, type TapInput } from "../src/lib/exercise-taps.ts";

// --- tapChange: which tap a tick is --------------------------------------------------------

const ROWS = [
  { key: "a", name: "Squat" },
  { key: "b", name: "squat " }, // same exercise: trimmed, case-insensitive
  { key: "c", name: "Dips" },
  { key: "d", name: "Facepulls" },
];
const ticked = (...keys: string[]) => (key: string) => keys.includes(key);

test("tapChange: first tick starts, the completing tick ends and names the next exercise", () => {
  assert.deepEqual(tapChange(ROWS, ticked(), "a", true), {
    kind: "start",
    exercise: "Squat",
    next: null,
  });
  assert.deepEqual(tapChange(ROWS, ticked("a"), "b", true), {
    kind: "end",
    exercise: "squat",
    next: "Dips",
  });
  // A one-row exercise: its only tick is its end (the server also sets its start).
  assert.equal(tapChange(ROWS, ticked("a", "b"), "c", true)?.kind, "end");
  assert.equal(tapChange(ROWS, ticked(), "d", true)?.next, null); // the last exercise
});

test("tapChange: unticking a done exercise undoes its end, its only tick undoes its start", () => {
  assert.deepEqual(tapChange(ROWS, ticked("a", "b"), "a", false), {
    kind: "undo-end",
    exercise: "Squat",
    next: "Dips",
  });
  assert.deepEqual(tapChange(ROWS, ticked("c"), "c", false)?.kind, "undo-end");
  assert.deepEqual(tapChange([...ROWS, { key: "e", name: "Facepulls" }], ticked("d"), "d", false), {
    kind: "undo-start",
    exercise: "Facepulls",
    next: null,
  });
});

test("tapChange: a middle row of an exercise is not a tap", () => {
  const three = [
    { key: "a", name: "Squat" },
    { key: "b", name: "Squat" },
    { key: "c", name: "Squat" },
  ];
  assert.equal(tapChange(three, ticked("a"), "b", true), null);
  assert.equal(tapChange(three, ticked("a", "b"), "b", false), null);
  assert.equal(tapChange(three, ticked(), "zz", true), null);
});

test("parseTapInput: exact shape only", () => {
  const ok = { kind: "end", exercise: " Squat ", next: "Dips", date: "2026-10-12", session: 2, at: null };
  assert.deepEqual(parseTapInput(ok), { ...ok, exercise: "Squat" });
  const undo = { ...ok, kind: "undo-end", at: "2026-10-12T08:05:00.123+00:00" };
  assert.deepEqual(parseTapInput(undo), { ...undo, exercise: "Squat" });
  for (const bad of [
    null,
    "x",
    { ...ok, kind: "delete" },
    { ...ok, exercise: "" },
    { ...ok, exercise: "x".repeat(201) },
    { ...ok, next: 3 },
    { ...ok, at: undefined },
    { ...ok, at: "2026-10-12T08:05:00.000Z" }, // start / end never carry a time
    { ...undo, at: null }, // an undo always does
    { ...undo, at: "yesterday" },
    { ...undo, at: "2026-10-12T25:61:00Z" },
    { ...ok, date: "12-10-2026" },
    { ...ok, session: 0 },
    { ...ok, session: 1.5 },
    { ...ok, session: 15 },
  ]) {
    assert.equal(parseTapInput(bad), null, JSON.stringify(bad));
  }
});

// --- recordTap against an in-memory PostgREST -----------------------------------------------

type Row = Record<string, unknown>;

type FakeDb = {
  readonly tables: Record<string, Row[]>;
  readonly calls: string[];
  failWith?: number;
};

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

function fakeDb(): FakeDb {
  return {
    tables: {
      strength_sets: [
        { week_start: "2026-10-12", session: 1, name: "Squat" },
        { week_start: "2026-10-12", session: 1, name: "Squat" },
        { week_start: "2026-10-12", session: 1, name: "Dips" },
        { week_start: "2026-10-12", session: 1, name: "Facepulls" },
        { week_start: "2026-10-12", session: 2, name: "Dødløft" },
        { week_start: "2026-10-12", session: 2, name: "Dip" }, // the sheet's spelling: an alias
      ],
      exercises: [
        { id: 1, name: "Squat", aliases: [] },
        { id: 2, name: "Dips", aliases: ["Dip"] },
        { id: 3, name: "Facepulls", aliases: [] },
        { id: 4, name: "Dødløft", aliases: [] },
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
    if (db.failWith !== undefined) return new Response("{}", { status: db.failWith });
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
        rows.push({ started_at: null, ended_at: null, ...body });
      }
    } else if (method === "PATCH") {
      for (const r of rows) if (matches(r, parsed.searchParams)) Object.assign(r, body);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

const MORNING = new Date("2026-10-12T08:00:00.000Z"); // 10:00 in Copenhagen
const at = (minutes: number) => new Date(MORNING.getTime() + minutes * 60_000);
const iso = (minutes: number) => at(minutes).toISOString();

function options(db: FakeDb, overrides: Partial<RecordOptions> = {}): RecordOptions {
  return {
    env: {},
    nodeEnv: "production",
    client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)),
    ...overrides,
  };
}

function tap(kind: TapInput["kind"], exercise: string, more: Partial<TapInput> = {}): TapInput {
  return { kind, exercise, next: null, date: "2026-10-12", session: 1, at: null, ...more };
}

function log(db: FakeDb): Array<[unknown, unknown, unknown]> {
  return db.tables.exercise_log.map((r) => [r.exercise_id, r.started_at, r.ended_at]);
}

test("recordTap: first tick starts X; the completing tick ends X and starts the next", async () => {
  const db = fakeDb();
  assert.deepEqual(await recordTap(tap("start", "Squat"), at(0), options(db)), { ok: true, at: iso(0) });
  assert.deepEqual(log(db), [[1, iso(0), null]]);
  await recordTap(tap("end", "Squat", { next: "Dips" }), at(5), options(db));
  assert.deepEqual(log(db), [
    [1, iso(0), iso(5)],
    [2, iso(5), null],
  ]);
  // Dips is one row: its tick ends it; its start stays the one Squat's end gave it.
  await recordTap(tap("end", " DIPS", { next: "Facepulls" }), at(9), options(db));
  assert.deepEqual(log(db), [
    [1, iso(0), iso(5)],
    [2, iso(5), iso(9)],
    [3, iso(9), null],
  ]);
});

test("recordTap: a sheet name that is an alias logs under its exercise", async () => {
  const db = fakeDb();
  await recordTap(tap("start", "Dip", { session: 2 }), at(0), options(db));
  assert.deepEqual(log(db), [[2, iso(0), null]]);
});

test("recordTap: re-ticking after a reload changes nothing (first write wins, no duplicates)", async () => {
  const db = fakeDb();
  await recordTap(tap("start", "Squat"), at(0), options(db));
  await recordTap(tap("end", "Squat", { next: "Dips" }), at(5), options(db));
  await recordTap(tap("start", "Squat"), at(30), options(db));
  await recordTap(tap("end", "Squat", { next: "Dips" }), at(31), options(db));
  assert.deepEqual(log(db), [
    [1, iso(0), iso(5)],
    [2, iso(5), null],
  ]);
});

/** The timestamp a start / end tap returned (what it wrote), as the client keeps it. */
async function written(input: TapInput, when: Date, db: FakeDb): Promise<string | null> {
  const result = await recordTap(input, when, options(db));
  assert.equal(result.ok, true);
  return result.ok ? result.at : null;
}

test("recordTap: a tap returns what it wrote, and undo with that clears exactly it", async () => {
  const db = fakeDb();
  const start = await written(tap("start", "Squat"), at(0), db);
  const end = await written(tap("end", "Squat", { next: "Dips" }), at(5), db);
  assert.deepEqual([start, end], [iso(0), iso(5)]);
  await recordTap(tap("undo-end", "Squat", { next: "Dips", at: end }), at(6), options(db));
  assert.deepEqual(log(db), [[1, iso(0), null]]); // Squat's real start stays; Dips' row is gone
  await recordTap(tap("undo-start", "Squat", { at: start }), at(7), options(db));
  assert.deepEqual(log(db), []);

  // A one-row first exercise: its tap wrote start and end, so its undo removes the row.
  const one = await written(tap("end", "Facepulls"), at(10), db);
  await recordTap(tap("undo-end", "Facepulls", { at: one }), at(11), options(db));
  assert.deepEqual(log(db), []);
});

test("recordTap: a tap that wrote nothing returns no timestamp, so there is nothing to undo", async () => {
  const db = fakeDb();
  await written(tap("end", "Dips", { next: "Facepulls" }), at(0), db);
  // Facepulls' first tick: its start was already written by Dips' end (first write wins).
  assert.equal(await written(tap("start", "Facepulls"), at(3), db), null);
  // An undo carrying any other tap's timestamp clears nothing.
  await recordTap(tap("undo-start", "Facepulls", { at: iso(3) }), at(4), options(db));
  assert.deepEqual(log(db), [
    [2, iso(0), iso(0)],
    [3, iso(0), null],
  ]);
});

test("recordTap: another day, a name outside the session or unknown is refused, nothing written", async () => {
  const db = fakeDb();
  const refused = { ok: false, reason: "invalid" };
  assert.deepEqual(await recordTap(tap("start", "Squat", { date: "2026-10-11" }), at(0), options(db)), refused);
  assert.deepEqual(await recordTap(tap("start", "Dødløft"), at(0), options(db)), refused); // session 2
  assert.deepEqual(await recordTap(tap("end", "Squat", { next: "Bench" }), at(0), options(db)), refused);
  assert.deepEqual(log(db), []);
  assert.ok(db.calls.every((c) => c.startsWith("GET")));
});

test("recordTap: dev switches write nothing and read nothing", async () => {
  const db = fakeDb();
  for (const env of [{ DEV_TODAY: "2026-10-09" }, { DEV_FIXTURE: "stale" }]) {
    const result = await recordTap(tap("start", "Squat"), at(0), options(db, { env, nodeEnv: "development" }));
    assert.deepEqual(result, { ok: false, reason: "dev" });
  }
  assert.deepEqual(db.calls, []);
});

test("recordTap: a database failure is reported, never thrown", async () => {
  const db = fakeDb();
  db.failWith = 500;
  assert.deepEqual(await recordTap(tap("start", "Squat"), at(0), options(db)), { ok: false, reason: "failed" });
});
