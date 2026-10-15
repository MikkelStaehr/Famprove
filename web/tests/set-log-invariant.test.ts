import assert from "node:assert/strict";
import { test } from "node:test";

import { recordSetTap, type RecordOptions } from "../src/lib/db/set-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import {
  applyTap,
  firstOpen,
  lastTap,
  type LoggedSet,
  progress,
  restStart,
  sessionOrderWithWarmups,
  setKey,
  type SetRef,
  type SetTapKind,
  stateOf,
  type Undoes,
  undoesOf,
} from "../src/lib/set-taps.ts";

// Invariant tests (tester, 2026-10-12): seeded random tap sequences against the server's write
// path (an in-memory PostgREST that enforces the table's checks and primary key), with the
// client's optimistic mirror (applyTap) and the table's own rules as the oracle after every step.

type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]>; writes: Row[]; failAt?: number; requests: number };

const PK = ["date", "session_no", "row_no", "set_no"];
const ALLOWED = new Set([...PK, "exercise_id", "kind", "started_at", "ended_at", "skipped", "updated_at", "felt_rpe", "reps_done"]);

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
  [14, 1, "Dip"], // a range (6 - 10): its done also writes reps_done
];
const REPS_TEXT: Readonly<Record<number, string>> = { 14: "6 - 10" };
// Warm-ups (set 0) before rows 10 (Bænkpres), 13 (Squat) and 14 (Dip): the server's order.
const ORDER = sessionOrderWithWarmups(SHEET.map(([row, set, name]) => ({ ref: { row, set }, name })));
const SETS = ORDER.filter((ref) => ref.set > 0);

function fakeDb(): FakeDb {
  return {
    tables: {
      strength_sets: SHEET.map(([sheet_row, set_no, name]) => ({
        week_start: "2026-10-12",
        session: 1,
        sheet_row,
        set_no,
        name,
        reps_text: REPS_TEXT[sheet_row] ?? "3",
      })),
      exercises: [
        { id: 1, name: "Bænkpres", aliases: [] },
        { id: 2, name: "Squat", aliases: [] },
        { id: 3, name: "Dips", aliases: ["Dip"] },
      ],
      exercise_set_log: [],
      superset_pairs: [],
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function shape(log: ReadonlyMap<string, LoggedSet>) {
  return ORDER.map((ref) => {
    const l = log.get(setKey(ref));
    return [setKey(ref), stateOf(l), l?.startedAt ?? null, l?.endedAt ?? null];
  });
}

function assertTableInvariants(db: FakeDb, ctx: string, partial = false) {
  const rows = db.tables.exercise_set_log;
  assert.ok(rows.every(valid), `${ctx}: a row breaks the table's check`);
  const keys = rows.map((r) => PK.map((k) => String(r[k])).join("|"));
  assert.equal(new Set(keys).size, keys.length, `${ctx}: duplicate primary key`);
  if (!partial) assert.ok(rows.every((r) => r.started_at !== null || r.ended_at !== null || r.skipped === true), `${ctx}: an empty row is left`);
  for (const w of db.writes) {
    assert.equal(w.table, "exercise_set_log", `${ctx}: wrote to ${String(w.table)}`);
    for (const k of Object.keys(w)) if (k !== "table" && k !== "method") assert.ok(ALLOWED.has(k), `${ctx}: wrote column ${k}`);
  }
  const p = progress(ORDER, dbLog(db));
  assert.ok(p.done + p.skipped <= p.total && p.total === SETS.length, `${ctx}: progress out of bounds`);
  for (const r of rows) assert.equal(r.kind, Number(r.set_no) === 0 ? "warmup" : "set", `${ctx}: kind of ${String(r.row_no)}#${String(r.set_no)}`);
}

/** The taps the screens can send for this log (Fokus, the overview ticks, Fortryd). */
function uiTaps(log: ReadonlyMap<string, LoggedSet>): Array<[SetTapKind, SetRef]> {
  const taps: Array<[SetTapKind, SetRef]> = [];
  const first = firstOpen(ORDER, log);
  if (first !== null) taps.push(["begin", first], ["done", first], ["skip", first]);
  const last = lastTap(log);
  if (last !== null) taps.push(["undo", last.ref]); // Fortryd
  for (const ref of SETS) {
    const s = stateOf(log.get(setKey(ref)));
    if (s === "open" || s === "skipped") taps.push(["done", ref]); // overview tick
    if (s === "done") taps.push(["undo", ref]); // overview untick
  }
  return taps;
}

const DAY0 = Date.parse("2026-10-12T08:00:00.000Z");

/** What the screen sends with an undo: what it saw on the set (useSetLog does the same). */
function intent(kind: SetTapKind, ref: SetRef, log: ReadonlyMap<string, LoggedSet>): Undoes | null {
  return kind === "undo" ? (undoesOf(log, ref) ?? "done") : null;
}
console.error = () => {}; // recordSetTap logs each refused save; the assertions carry the result

test("invariant: 120 seeded UI tap sequences, server log == client mirror after every step; table checks hold; kg never written", async () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rnd = mulberry32(seed);
    const db = fakeDb();
    let mirror: ReadonlyMap<string, LoggedSet> = new Map();
    let clock = DAY0;
    for (let step = 0; step < 25; step++) {
      clock += 1000 + Math.floor(rnd() * 240_000);
      const taps = uiTaps(mirror);
      const [kind, ref] = taps[Math.floor(rnd() * taps.length)];
      const at = new Date(clock);
      const ctx = `seed ${seed} step ${step} ${kind} ${setKey(ref)}`;
      const result = await recordSetTap({ kind, date: "2026-10-12", session: 1, row: ref.row, set: ref.set, undoes: intent(kind, ref, mirror) }, at, options(db));
      assert.deepEqual(result, { ok: true, at: at.toISOString() }, ctx);
      mirror = applyTap(ORDER, mirror, kind, ref, at.toISOString());
      assertTableInvariants(db, ctx);
      assert.deepEqual(shape(dbLog(db)), shape(mirror), `${ctx}: reload differs from the screen`);
      // A reload's rest timer counts from the latest done tap, exactly as the screen did.
      assert.equal(restStart(dbLog(db)), restStart(mirror), `${ctx}: rest start`);
    }
  }
});

test("invariant: arbitrary taps on any set (not only the UI's) never break the table or write kg", async () => {
  const kinds: SetTapKind[] = ["begin", "done", "skip", "undo"];
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry32(1000 + seed);
    const db = fakeDb();
    let clock = DAY0;
    for (let step = 0; step < 30; step++) {
      clock += Math.floor(rnd() * 120_000);
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const ref = ORDER[Math.floor(rnd() * ORDER.length)];
      const ctx = `seed ${seed} step ${step} ${kind} ${setKey(ref)}`;
      const result = await recordSetTap({ kind, date: "2026-10-12", session: 1, row: ref.row, set: ref.set, undoes: intent(kind, ref, dbLog(db)) }, new Date(clock), options(db));
      assert.ok(result.ok || result.reason === "invalid", `${ctx}: ${JSON.stringify(result)}`);
      assertTableInvariants(db, ctx);
    }
  }
});

test("environment: a backwards clock never writes an end before its start (refused as failed, table intact)", async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rnd = mulberry32(5000 + seed);
    const db = fakeDb();
    let mirror: ReadonlyMap<string, LoggedSet> = new Map();
    let clock = DAY0 + 3_600_000;
    for (let step = 0; step < 20; step++) {
      clock += Math.floor((rnd() - 0.6) * 300_000); // drifts backwards on average
      const taps = uiTaps(mirror);
      const [kind, ref] = taps[Math.floor(rnd() * taps.length)];
      const ctx = `seed ${seed} step ${step} ${kind} ${setKey(ref)}`;
      const result = await recordSetTap({ kind, date: "2026-10-12", session: 1, row: ref.row, set: ref.set, undoes: intent(kind, ref, mirror) }, new Date(clock), options(db));
      assert.ok(result.ok || result.reason === "failed", `${ctx}: ${JSON.stringify(result)}`);
      assertTableInvariants(db, ctx);
      mirror = dbLog(db); // the screen re-reads the server's truth
    }
  }
});

test("environment: storage failing mid-tap leaves a valid table; Gem igen (the same tap again) reaches the mirror's state", async () => {
  const findings: string[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = mulberry32(9000 + seed);
    const db = fakeDb();
    let mirror: ReadonlyMap<string, LoggedSet> = new Map();
    let clock = DAY0;
    for (let step = 0; step < 15; step++) {
      clock += 1000 + Math.floor(rnd() * 240_000);
      const taps = uiTaps(mirror);
      const [kind, ref] = taps[Math.floor(rnd() * taps.length)];
      const input = { kind, date: "2026-10-12", session: 1, row: ref.row, set: ref.set, undoes: intent(kind, ref, mirror) } as const;
      const ctx = `seed ${seed} step ${step} ${kind} ${setKey(ref)}`;
      db.requests = 0;
      db.failAt = rnd() < 0.3 ? 1 + Math.floor(rnd() * 8) : undefined;
      const first = await recordSetTap(input, new Date(clock), options(db));
      assertTableInvariants(db, ctx, !first.ok); // a half-written tap may leave an emptied row until its retry
      mirror = applyTap(ORDER, mirror, kind, ref, new Date(clock).toISOString());
      if (!first.ok) {
        assert.equal(first.reason, "failed", ctx);
        db.failAt = undefined;
        clock += 5000;
        const again = await recordSetTap(input, new Date(clock), options(db)); // retry stamps its own time
        assert.ok(again.ok, `${ctx}: retry`);
        assertTableInvariants(db, `${ctx} retry`);
        const states = (l: ReadonlyMap<string, LoggedSet>) => ORDER.map((r) => stateOf(l.get(setKey(r))));
        const startsMissing = ORDER.filter((r) => {
          const m = mirror.get(setKey(r));
          const d = dbLog(db).get(setKey(r));
          return m?.startedAt != null && d?.startedAt == null;
        });
        if (JSON.stringify(states(dbLog(db))) !== JSON.stringify(states(mirror))) findings.push(`${ctx}: states differ after retry`);
        else if (startsMissing.length > 0) findings.push(`${ctx}: start lost after retry on ${startsMissing.map(setKey).join(",")}`);
      }
      db.failAt = undefined;
      mirror = dbLog(db); // a reload: the server's truth
    }
  }
  assert.deepEqual(findings, [], `${findings.length} findings, first: ${findings[0]}`);
});

test("Udført with the connection lost after its own write: Gem igen still starts the next set", async () => {
  const db = fakeDb();
  const input = { kind: "done", date: "2026-10-12", session: 1, row: 13, set: 1, undoes: null } as const;
  // Requests: GET strength_sets, GET exercises, GET log, POST+PATCH+PATCH own set, then the next set's.
  db.failAt = 7;
  const first = await recordSetTap(input, new Date(DAY0), options(db));
  assert.deepEqual(first, { ok: false, reason: "failed" });
  db.failAt = undefined;
  await recordSetTap(input, new Date(DAY0 + 5000), options(db)); // Gem igen
  const next = dbLog(db).get("13#2");
  assert.ok(next?.startedAt != null, `13#2 has no started_at after the retry: ${JSON.stringify([...dbLog(db).values()])}`);
});
