import assert from "node:assert/strict";
import { test } from "node:test";

import { recordTap, type RecordOptions } from "../src/lib/db/exercise-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import type { TapInput } from "../src/lib/exercise-taps.ts";

// Tester's re-check of the undo token (fix c74976e): what a tap returns, and that an undo clears
// only fields that still hold exactly the token it carries.

type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; readonly calls: string[]; failOnWrite?: number };

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
      strength_sets: ["Squat", "Squat", "Dips", "Facepulls"].map((name) => ({
        week_start: "2026-10-12",
        session: 1,
        name,
      })),
      exercises: [
        { id: 1, name: "Squat", aliases: [] },
        { id: 2, name: "Dips", aliases: [] },
        { id: 3, name: "Facepulls", aliases: [] },
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
    const writes = db.calls.filter((c) => !c.startsWith("GET")).length;
    if (method !== "GET" && db.failOnWrite === writes) return new Response("{}", { status: 503 });
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
      if (!rows.some((r) => key.every((k) => r[k] === body[k]))) rows.push({ started_at: null, ended_at: null, ...body });
    } else if (method === "PATCH") {
      for (const r of rows) if (matches(r, parsed.searchParams)) Object.assign(r, body);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

const MORNING = new Date("2026-10-12T08:00:00.000Z");
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

async function token(input: TapInput, when: Date, db: FakeDb): Promise<string | null> {
  const result = await recordTap(input, when, options(db));
  assert.equal(result.ok, true);
  return result.ok ? result.at : null;
}

test("an undo whose token matches nothing changes nothing (undo-end and undo-start)", async () => {
  const db = fakeDb();
  await token(tap("start", "Squat"), at(0), db);
  await token(tap("end", "Squat", { next: "Dips" }), at(5), db);
  const before = log(db);
  for (const stale of [iso(1), iso(4), "2026-10-12T08:05:00.001Z", "2026-10-11T08:05:00.000Z"]) {
    await recordTap(tap("undo-end", "Squat", { next: "Dips", at: stale }), at(6), options(db));
    await recordTap(tap("undo-start", "Squat", { at: stale }), at(6), options(db));
    await recordTap(tap("undo-start", "Dips", { at: stale }), at(6), options(db));
  }
  assert.deepEqual(log(db), before);
  assert.deepEqual(before, [
    [1, iso(0), iso(5)],
    [2, iso(5), null],
  ]);
});

test("an end that only wrote the next start returns its token; its undo clears only that", async () => {
  const db = fakeDb();
  await token(tap("end", "Squat"), at(0), db); // Squat [0, 0]; next unknown then (e.g. reload)
  const t = await token(tap("end", "Squat", { next: "Dips" }), at(5), db); // writes Dips.start only
  assert.equal(t, iso(5));
  assert.deepEqual(log(db), [
    [1, iso(0), iso(0)],
    [2, iso(5), null],
  ]);
  await recordTap(tap("undo-end", "Squat", { next: "Dips", at: t }), at(6), options(db));
  assert.deepEqual(log(db), [[1, iso(0), iso(0)]]);
});

test("re-ticks after a reload return no token for start and end (B3)", async () => {
  const db = fakeDb();
  await token(tap("start", "Squat"), at(0), db);
  await token(tap("end", "Squat", { next: "Dips" }), at(5), db);
  assert.equal(await token(tap("start", "Squat"), at(30), db), null);
  assert.equal(await token(tap("end", "Squat", { next: "Dips" }), at(31), db), null);
  assert.equal(db.tables.exercise_log.length, 2);
});

test("an undo without a token reaching recordTap is refused, nothing written (B5)", async () => {
  const db = fakeDb();
  await token(tap("end", "Dips"), at(0), db);
  const writes = db.calls.filter((c) => !c.startsWith("GET")).length;
  for (const kind of ["undo-end", "undo-start"] as const) {
    assert.deepEqual(await recordTap(tap(kind, "Dips"), at(1), options(db)), { ok: false, reason: "invalid" });
  }
  assert.equal(db.calls.filter((c) => !c.startsWith("GET")).length, writes);
  assert.deepEqual(log(db), [[2, iso(0), iso(0)]]);
});

test("dev switches refuse an undo too, before any request (B7)", async () => {
  const db = fakeDb();
  const result = await recordTap(
    tap("undo-end", "Dips", { at: iso(0) }),
    at(1),
    options(db, { env: { DEV_FIXTURE: "empty" }, nodeEnv: "development" }),
  );
  assert.deepEqual(result, { ok: false, reason: "dev" });
  assert.deepEqual(db.calls, []);
});

test("a failed end save returns no token, even after a partial write", async () => {
  const db = fakeDb();
  db.failOnWrite = 4; // POST + 2 PATCH for Squat succeed, the POST for Dips' start fails
  const result = await recordTap(tap("end", "Squat", { next: "Dips" }), at(5), options(db));
  assert.deepEqual(result, { ok: false, reason: "failed" });
  // Known limit: Squat's part stays written and no token reaches the client to undo it.
  assert.deepEqual(log(db), [[1, iso(5), iso(5)]]);
});
