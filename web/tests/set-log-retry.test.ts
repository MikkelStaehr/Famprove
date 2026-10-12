import assert from "node:assert/strict";
import { test } from "node:test";

import { recordSetTap, type RecordOptions } from "../src/lib/db/set-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import { type LoggedSet, sessionOrder, setKey, type SetTapInput } from "../src/lib/set-taps.ts";

// Retry safety (tester, re-check on 7c8f5af): every split point of a tap, then Gem igen once or twice.
type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; writes: Row[]; failAt?: number; requests: number };

const PK = ["date", "session_no", "row_no", "set_no"];
const ALLOWED = new Set([...PK, "exercise_id", "started_at", "ended_at", "skipped", "updated_at"]);

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

// Bænk 1 + 1 + 2 sets (a run over three rows), Squat 2 sets, Dips 1 set.
const SHEET: Array<[number, number, string]> = [
  [10, 1, "Bænkpres"],
  [11, 1, "Bænkpres"],
  [12, 1, "Bænkpres"],
  [12, 2, "Bænkpres"],
  [13, 1, "Squat"],
  [13, 2, "Squat"],
  [14, 1, "Dip"],
];
const ORDER = sessionOrder(SHEET.map(([row, set]) => ({ row, set })));

function fakeDb(): FakeDb {
  return {
    tables: {
      strength_sets: SHEET.map(([sheet_row, set_no, name]) => ({ week_start: "2026-10-12", session: 1, sheet_row, set_no, name })),
      exercises: [
        { id: 1, name: "Bænkpres", aliases: [] },
        { id: 2, name: "Squat", aliases: [] },
        { id: 3, name: "Dips", aliases: ["Dip"] },
      ],
      exercise_set_log: [],
    },
    writes: [],
    requests: 0,
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
    if (method !== "GET") db.writes.push({ table, method, ...body });
    if (method === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      const range = found.length ? `0-${found.length - 1}/${found.length}` : "*/0";
      return new Response(JSON.stringify(found), { headers: { "Content-Range": range } });
    }
    if (method === "POST") {
      if (!rows.some((r) => PK.every((k) => r[k] === body[k]))) {
        const row = { started_at: null, ended_at: null, skipped: false, ...body };
        if (!valid(row)) return new Response("{}", { status: 400 });
        rows.push(row);
      }
    } else if (method === "PATCH") {
      const hit = rows.filter((r) => matches(r, parsed.searchParams));
      if (hit.some((r) => !valid({ ...r, ...body }))) return new Response("{}", { status: 400 }); // atomic, as Postgres
      for (const r of hit) Object.assign(r, body);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

function options(db: FakeDb): RecordOptions {
  return { env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) };
}

function dbLog(db: FakeDb): Map<string, LoggedSet> {
  return new Map(
    db.tables.exercise_set_log.map((r) => {
      const l: LoggedSet = {
        row: Number(r.row_no),
        set: Number(r.set_no),
        startedAt: (r.started_at as string | null) ?? null,
        endedAt: (r.ended_at as string | null) ?? null,
        skipped: r.skipped === true,
        updatedAt: (r.updated_at as string | null) ?? null,
      };
      return [setKey(l), l];
    }),
  );
}

console.error = () => {}; // recordSetTap logs each refused save
const T = (m: number) => new Date(Date.parse("2026-10-12T08:00:00.000Z") + m * 60_000);
const tap = (kind: SetTapInput["kind"], row: number, set: number, undoes: SetTapInput["undoes"] = null): SetTapInput => ({
  kind, date: "2026-10-12", session: 1, row, set, undoes,
});
function rowOf(db: FakeDb, key: string): LoggedSet | undefined {
  return dbLog(db).get(key);
}
async function ok(db: FakeDb, input: SetTapInput, at: Date) {
  db.failAt = undefined;
  db.requests = 0;
  assert.deepEqual(await recordSetTap(input, at, options(db)), { ok: true, at: at.toISOString() });
}
/** Runs `input` failing from request n on, then Gem igen (twice), and returns the db. */
async function splitThenRetry(setup: (db: FakeDb) => Promise<void>, input: SetTapInput, at: Date, n: number) {
  const db = fakeDb();
  await setup(db);
  db.requests = 0;
  db.failAt = n;
  const first = await recordSetTap(input, at, options(db));
  const landed = first.ok;
  assert.ok(db.tables.exercise_set_log.every(valid), `split ${n}: table check`);
  await ok(db, input, T(30)); // Gem igen, at a later server time
  await ok(db, input, T(31)); // a duplicate retry
  assert.ok(db.tables.exercise_set_log.every(valid), `split ${n}: table check after retry`);
  return { db, landed };
}

test("Udført split at every request: Gem igen starts the next set with the tap's own time; a duplicate changes nothing", async () => {
  for (let n = 1; n <= 14; n++) {
    const { db } = await splitThenRetry(async (db) => { await ok(db, tap("begin", 13, 1), T(0)); }, tap("done", 13, 1), T(2), n);
    const own = rowOf(db, "13#1");
    const next = rowOf(db, "13#2");
    assert.equal(own?.startedAt, T(0).toISOString(), `split ${n}: own start (the begin) kept`);
    assert.ok(own?.endedAt != null, `split ${n}: own set done`);
    assert.equal(next?.startedAt, own?.endedAt, `split ${n}: next set starts at this set's end (one tap, one T)`);
    assert.equal(db.tables.exercise_set_log.length, 2, `split ${n}: one row per set`);
  }
});

test("Spring over split at every request: the set is skipped with no timestamps; the next set starts at the skip's time", async () => {
  for (let n = 1; n <= 14; n++) {
    const { db } = await splitThenRetry(async (db) => { await ok(db, tap("done", 10, 1), T(0)); }, tap("skip", 11, 1), T(2), n);
    const skipped = rowOf(db, "11#1");
    assert.equal(skipped?.skipped, true, `split ${n}`);
    assert.equal(skipped?.startedAt, null, `split ${n}: skipped has no start`);
    assert.equal(skipped?.endedAt, null, `split ${n}: skipped has no end`);
    assert.equal(rowOf(db, "12#1")?.startedAt, skipped?.updatedAt, `split ${n}: next start = the skip's time`);
    assert.equal(rowOf(db, "10#1")?.endedAt, T(0).toISOString(), `split ${n}: earlier set untouched`);
  }
});

test("Fortryd of a done, split at every request and retried twice, leaves the begun set's own start alone", async () => {
  for (let n = 1; n <= 14; n++) {
    const setup = async (db: FakeDb) => {
      await ok(db, tap("begin", 10, 1), T(0));
      await ok(db, tap("done", 10, 1), T(2));
    };
    const { db } = await splitThenRetry(setup, tap("undo", 10, 1, "done"), T(3), n);
    const own = rowOf(db, "10#1");
    assert.equal(own?.startedAt, T(0).toISOString(), `split ${n}: Begynd's start kept`);
    assert.equal(own?.endedAt, null, `split ${n}: the done is undone`);
    assert.equal(rowOf(db, "11#1"), undefined, `split ${n}: the start the done wrote on the next set is gone`);
  }
});

test("Fortryd of a skip, split at every request and retried twice: start restored from the previous set, next set's start gone", async () => {
  for (let n = 1; n <= 16; n++) {
    const setup = async (db: FakeDb) => {
      await ok(db, tap("begin", 10, 1), T(0));
      await ok(db, tap("done", 10, 1), T(2));
      await ok(db, tap("skip", 11, 1), T(4));
    };
    const { db } = await splitThenRetry(setup, tap("undo", 11, 1, "skip"), T(5), n);
    assert.deepEqual(
      [rowOf(db, "10#1")?.startedAt, rowOf(db, "10#1")?.endedAt],
      [T(0).toISOString(), T(2).toISOString()],
      `split ${n}: set 1 untouched`,
    );
    const own = rowOf(db, "11#1");
    assert.equal(own?.skipped, false, `split ${n}: no longer skipped`);
    assert.equal(own?.startedAt, T(2).toISOString(), `split ${n}: start back from set 1's end`);
    assert.equal(rowOf(db, "12#1"), undefined, `split ${n}: the skip's start on the next set is gone`);
  }
});

test("Fortryd of a begin, retried after the set was done meanwhile, does not undo the done or its start", async () => {
  const db = fakeDb();
  await ok(db, tap("begin", 10, 1), T(0));
  await ok(db, tap("done", 10, 1), T(2));
  await ok(db, tap("undo", 10, 1, "begin"), T(3)); // a stale undo of the begin
  assert.deepEqual([rowOf(db, "10#1")?.startedAt, rowOf(db, "10#1")?.endedAt], [T(0).toISOString(), T(2).toISOString()]);
  assert.equal(rowOf(db, "11#1")?.startedAt, T(2).toISOString());
});
