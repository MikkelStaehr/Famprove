import assert from "node:assert/strict";
import { test } from "node:test";

import { recordSetTap, type RecordOptions } from "../src/lib/db/set-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import {
  applyChanges,
  applyOrderChanges,
  applyTap,
  lastTap,
  type LoggedSet,
  type PairRef,
  rangeTops,
  type SessionShape,
  setKey,
  shapeOrder,
  type SetRef,
  type SetTapKind,
  transition,
  undoesOf,
} from "../src/lib/set-taps.ts";

// One tap transition (slice tap-transition, user 2026-10-16): the client's applyTap and the
// server's recordSetTap follow one copy of the rules (set-taps.ts transition). Seeded random taps,
// offered or not, on plain and paired sessions: after every step the client's log equals the
// rows the server stored on an in-memory PostgREST.

const DATE = "2026-10-12";
const DAY0 = Date.parse("2026-10-12T08:00:00.000Z"); // 10:00 Copenhagen: every tap is "today"

type Ex = { readonly row: number; readonly name: string; readonly repsText: string; readonly sets: readonly SetRef[] };
const ex = (row: number, name: string, n: number, repsText = "5"): Ex => ({ row, name, repsText, sets: Array.from({ length: n }, (_, k) => ({ row, set: k + 1 })) });
type Session = { readonly exercises: readonly Ex[]; readonly pairs: readonly PairRef[] };

const PLAIN: Session = { pairs: [], exercises: [ex(10, "Squat", 3), ex(11, "DB Row", 3, "8 - 12"), ex(12, "Curl", 2, "12"), ex(13, "Dips", 2, "6 - 10")] };
const paired = (a: number, b: number, row0: number): Session => ({
  pairs: [{ rowA: row0, rowB: row0 + 1 }],
  exercises: [ex(row0, "Bench", a), ex(row0 + 1, "Pull-ups", b, "6 - 8"), ex(row0 + 2, "Face Pull", 2, "15")],
});
const SESSIONS = [PLAIN, paired(3, 3, 30), paired(4, 3, 40)];
const IDS: Readonly<Record<string, number>> = { Squat: 1, "DB Row": 2, Curl: 3, Dips: 4, Bench: 6, "Pull-ups": 7, "Face Pull": 8 };

type Row = Record<string, unknown>;
const PK = ["date", "session_no", "row_no", "set_no"];

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null" && row[column] != null) return false;
    if (op === "is" && value === "false" && row[column] !== false) return false;
    if (op === "eq" && String(row[column]) !== value) return false;
  }
  return true;
}

function fakeDb(s: Session): Record<string, Row[]> {
  return {
    strength_sets: s.exercises.flatMap((e) => e.sets.map((r) => ({ week_start: DATE, session: 1, sheet_row: r.row, set_no: r.set, name: e.name, reps_text: e.repsText, variant_id: null }))),
    exercises: Object.entries(IDS).map(([name, id]) => ({ id, name, aliases: [] })),
    exercise_set_log: [],
    session_order: [],
    superset_pairs: s.pairs.map((p) => ({
      date: DATE, session_no: 1, row_a: p.rowA, row_b: p.rowB,
      exercise_a: IDS[s.exercises.find((e) => e.row === p.rowA)?.name ?? ""], variant_a: null,
      exercise_b: IDS[s.exercises.find((e) => e.row === p.rowB)?.name ?? ""], variant_b: null,
      paired: true, updated_at: "2026-10-12T07:00:00.000Z",
    })),
  };
}

function fetchFor(db: Record<string, Row[]>): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    const method = init.method ?? "GET";
    const rows = db[table];
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : {};
    if (method === "GET") {
      const cols = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      return new Response(JSON.stringify(found), { headers: { "Content-Range": found.length ? `0-${found.length - 1}/${found.length}` : "*/0" } });
    }
    if (method === "POST" && table === "session_order") {
      db[table] = [...rows.filter((r) => !(r.date === body.date && r.session_no === body.session_no)), body]; // upsert on its key
    } else if (method === "POST") {
      if (!rows.some((r) => PK.every((k) => r[k] === body[k]))) rows.push({ started_at: null, ended_at: null, skipped: false, felt_rpe: null, reps_done: null, ...body });
    } else if (method === "PATCH") {
      for (const r of rows.filter((x) => matches(x, parsed.searchParams))) Object.assign(r, body);
    } else if (method === "DELETE") {
      db[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

const ms = (t: unknown) => (typeof t === "string" ? Date.parse(t) : null);

function clientState(log: ReadonlyMap<string, LoggedSet>): string[] {
  return [...log.values()].map((l) => JSON.stringify([setKey(l), ms(l.startedAt), ms(l.endedAt), l.skipped, ms(l.updatedAt), l.feltRpe ?? null, l.repsDone ?? null])).toSorted();
}

function serverState(db: Record<string, Row[]>): string[] {
  return db.exercise_set_log.map((r) => JSON.stringify([`${String(r.row_no)}#${String(r.set_no)}`, ms(r.started_at), ms(r.ended_at), r.skipped === true, ms(r.updated_at), r.felt_rpe ?? null, r.reps_done ?? null])).toSorted();
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// "fortryd": Fokus's Fortryd (slice jump-undo): the latest tap with the session's shape, a jump included.
const KINDS: readonly (SetTapKind | "fortryd")[] = ["begin", "done", "done", "done", "skip", "undo", "undo", "feel", "reps", "jump", "jump", "fortryd", "fortryd"];

test("transition: the client's log and run order equal the server's stored rows after every tap, jumps included (200 seeded sequences)", async () => {
  console.error = () => {}; // recordSetTap logs refused saves
  let steps = 0;
  let jumps = 0;
  let jumpUndos = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const s = SESSIONS[seed % SESSIONS.length];
    // The order follows the client's run order after a jump (slice fokus-sheet), as the server's session_order.
    let shape: SessionShape = { sets: s.exercises.flatMap((e) => e.sets.map((ref) => ({ ref, name: e.name }))), pairs: s.pairs, runRows: null };
    const tops = rangeTops(s.exercises);
    const db = fakeDb(s);
    const options: RecordOptions = { env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) };
    const rnd = lcg(seed);
    const length = 10 + Math.floor(rnd() * 31); // 10..40 taps
    let log: ReadonlyMap<string, LoggedSet> = new Map();
    for (let i = 1; i <= length; i += 1) {
      const order = shapeOrder(shape);
      const picked = KINDS[Math.floor(rnd() * KINDS.length)];
      const latest = lastTap(log, shape);
      const fortryd = picked === "fortryd";
      if (fortryd && latest === null) continue;
      const kind: SetTapKind = fortryd ? "undo" : picked;
      const ref = fortryd && latest !== null ? latest.ref : order[Math.floor(rnd() * order.length)];
      const value = kind === "feel" ? [-1, 0, 1, null][Math.floor(rnd() * 4)] : kind === "reps" ? Math.floor(rnd() * 24) - 2 : null;
      const at = new Date(DAY0 + i * 60_000);
      // As useSetLog: a set's undo reads the set; Fokus's Fortryd reads the shape too (a jump, with the jump it saw).
      const undoes = kind === "undo" ? (undoesOf(log, ref, fortryd ? shape : undefined) ?? "done") : null;
      const seen = undoes === "jump" ? (shape.jump?.jumpedAt ?? null) : null;
      await recordSetTap({ kind, date: DATE, session: 1, row: ref.row, set: ref.set, undoes, value, ...(seen === null ? {} : { seen }) }, at, options);
      if (kind === "jump" || undoes === "jump") {
        const changes = transition(order, log, { kind, target: ref, undoes, value, seen }, at.toISOString(), tops, shape);
        if (changes !== null) {
          log = applyChanges(log, changes);
          shape = applyOrderChanges(shape, changes);
          if (kind === "jump") jumps += 1;
          else jumpUndos += 1;
        }
      } else {
        log = applyTap(order, log, kind, ref, at.toISOString(), value, tops, shape);
      }
      const label = `seed ${seed} step ${i}: ${picked} ${setKey(ref)} ${String(value)}`;
      assert.deepStrictEqual(clientState(log), serverState(db), label);
      const stored = db.session_order.at(0);
      assert.deepStrictEqual(shape.runRows, (stored?.run_rows as number[] | undefined) ?? null, `${label}: run order`);
      const mark = shape.jump ?? null;
      assert.deepStrictEqual(
        mark === null ? null : [mark.previousRows, ms(mark.jumpedAt), ms(mark.movedStart)],
        stored?.jumped_at == null ? null : [stored.previous_rows, ms(stored.jumped_at), ms(stored.moved_start)],
        `${label}: undo mark`,
      );
      steps += 1;
    }
  }
  assert.ok(steps >= 200 * 10);
  assert.ok(jumps >= 50, `only ${jumps} jumps landed`);
  assert.ok(jumpUndos >= 20, `only ${jumpUndos} jump Fortryds landed`);
});
