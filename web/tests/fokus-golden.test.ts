import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { recordSetTap, type RecordOptions } from "../src/lib/db/set-log.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";
import {
  displayName,
  doneLabel,
  feelQuestion,
  fokusView,
  nextFeel,
  repsRange,
  setInContext,
  setOneOf,
  stepperValue,
  begunWarmup,
} from "../src/lib/fokus-view.ts";
import {
  applyTap,
  firstOpen,
  isWarmup,
  lastTap,
  type LoggedSet,
  nextOpen,
  type PairRef,
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
import { handOffLabel, handOffName, pairHandOff, pairLine, restWindowOf, runSetsOf } from "../src/lib/superset-view.ts";
import { checklistView, type ExerciseView, spokenName } from "../src/lib/training-view.ts";

// Golden "before" snapshot (slice golden-test, user 2026-10-16): what Fokus and Træning derive
// after every tap, and what the server stores, for scripted and seeded tap sequences on synthetic
// sessions. The refactors (one shared tap transition; one fokusView with every derived field) must
// keep fixtures/fokus-golden.json identical. REGENERATE_FOKUS_GOLDEN=1 pnpm test rewrites it.
// Known client/server differences are recorded as data (`diff`), never asserted away.

const GOLDEN = fileURLToPath(new URL("./fixtures/fokus-golden.json", import.meta.url));
const DATE = "2026-10-12";
const DAY0 = Date.parse("2026-10-12T08:00:00.000Z"); // 10:00 Copenhagen: every tap is "today"

// ---------------------------------------------------------------- synthetic sessions

type Opts = Partial<ExerciseView> & { readonly sets?: never };

function ex(row: number, name: string, n: number, o: Opts = {}): ExerciseView {
  return {
    key: `r${row}`,
    name,
    variant: null,
    variantId: null,
    type: "",
    setsText: String(n),
    repsText: "5",
    prescribed: null,
    bodyweight: false,
    kg: null,
    reference: null,
    row,
    suggestedKg: null,
    suggestionBasis: null,
    suggestionCapped: false,
    adjustmentKg: null,
    adjustmentReason: null,
    restMinS: 90,
    restMaxS: 180,
    ramp: null,
    todayKg: null,
    todayBasis: null,
    ...o,
    sets: Array.from({ length: n }, (_, k) => ({ row, set: k + 1 })),
  };
}

const RAMP = [
  { pct: 40, reps: 5, kg: 40 },
  { pct: 60, reps: 3, kg: 60 },
  { pct: 80, reps: 2, kg: 80 },
];

type Session = { readonly name: string; readonly exercises: readonly ExerciseView[]; readonly pairs: readonly PairRef[] };

const PLAIN: Session = {
  name: "plain",
  pairs: [],
  exercises: [
    ex(10, "Squat", 3, { type: "SQUAT", prescribed: "RPE 7", restMinS: 180, restMaxS: 300, ramp: RAMP, todayKg: 100, todayBasis: "sheet", reference: { kg: 97.5, bodyweight: false } }),
    ex(11, "DB Row", 3, { repsText: "8 - 12", prescribed: "RPE 8", todayKg: 30, todayBasis: "derived" }),
    ex(12, "Curl", 2, { repsText: "12", restMinS: 60, restMaxS: 120, todayKg: 12.5, todayBasis: "last", reference: { kg: 12.5, bodyweight: false } }),
    ex(13, "Dips", 2, { repsText: "6 - 10", bodyweight: true, reference: { kg: 0, bodyweight: true } }),
    ex(14, "Lat Pulldown", 2, { repsText: "10", variant: "Wide Grip", variantId: 3 }),
    ex(15, "Lat Pulldown", 2, { repsText: "10", variant: "Close Grip", variantId: 4 }), // a variant run, no own warm-up
  ],
};

function supersetSession(name: string, aSets: number, bSets: number, row0: number): Session {
  return {
    name,
    pairs: [{ rowA: row0, rowB: row0 + 1 }],
    exercises: [
      ex(row0, "Bench", aSets, { type: "BENCH", prescribed: "RPE 7", restMinS: 120, restMaxS: 240, ramp: RAMP, todayKg: 80, todayBasis: "e1rm", suggestedKg: 80, suggestionBasis: "rpe_e1rm" }),
      ex(row0 + 1, "Pull-ups", bSets, { repsText: "6 - 8", bodyweight: true, restMinS: 180, restMaxS: 300 }),
      ex(row0 + 2, "Face Pull", 2, { repsText: "15", restMinS: 60, restMaxS: 120 }), // outside the pair
    ],
  };
}

const SESSIONS: readonly Session[] = [PLAIN, supersetSession("superset-3+3", 3, 3, 30), supersetSession("superset-4+3", 4, 3, 40)];
const EXERCISE_IDS: Readonly<Record<string, number>> = { Squat: 1, "DB Row": 2, Curl: 3, Dips: 4, "Lat Pulldown": 5, Bench: 6, "Pull-ups": 7, "Face Pull": 8 };

function orderOf(s: Session): SetRef[] {
  return sessionOrderWithWarmups(runSetsOf(s.exercises), s.pairs); // the client's order (clientOrder)
}

// ---------------------------------------------------------------- timestamps -> tap index

function tapIndex(iso: string | null | undefined): string | null {
  if (iso == null) return null;
  const ms = Date.parse(iso) - DAY0;
  return ms % 60_000 === 0 ? `t${ms / 60_000}` : `t?${iso}`;
}

/** Every ISO timestamp in a JSON value replaced by its tap index. */
function norm(value: unknown): unknown {
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}T/.test(value) ? tapIndex(value) : value;
  if (Array.isArray(value)) return value.map(norm);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, norm(v)]));
  return value;
}

const ref = (r: SetRef | null | undefined) => (r == null ? null : setKey(r));

// ---------------------------------------------------------------- screenFacts: what the screens derive

/**
 * What Fokus and Træning derive from (session, order, log), by today's pure functions, the way
 * FokusScreen.tsx / PauseParts.tsx / the Træning card call them. The refactor re-points this
 * block at the new fokusView fields; the JSON it returns must stay identical.
 */
function screenFacts(s: Session, order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>) {
  const exercises = s.exercises;
  const pairs = s.pairs;
  const view = fokusView(order, log, (after, next) => pairHandOff(exercises, pairs, after, next));
  const at = (r: SetRef) => setInContext(exercises, r);
  const latest = lastTap(log);
  const shown = view.kind === "set" ? view.next : view.kind === "warmup" ? view.warmup : null;
  const following = shown === null ? null : nextOpen(order, log, shown);
  const windowOf = (after: SetRef) => {
    const w = restWindowOf(exercises, pairs, after);
    return w === null ? null : [w.row.restMinS, w.row.restMaxS, w.superset];
  };
  // FokusScreen.restOfSet: the strip's window after view.rest.after (a warm-up's done: the set it opens).
  let restWindow: unknown = null;
  if (view.kind === "set" && view.rest !== null) {
    const win = restWindowOf(exercises, pairs, view.rest.after);
    const restOf = win?.superset === true ? win.row : (at(isWarmup(view.rest.after) ? view.next : view.rest.after)?.exercise ?? null);
    restWindow = [restOf?.restMinS ?? null, restOf?.restMaxS ?? null, win?.superset === true];
  }
  let label: { visible: string; spoken: string } | null = null;
  let pair: string | null = null;
  let warmupSince: string | null = null;
  if (view.kind === "set") {
    const next = at(view.next);
    const handOff = handOffName(exercises, pairs, view.next, following);
    if (next !== null) label = handOff === null ? doneLabel(next) : handOffLabel(handOff, next, spokenName(next.exercise));
    pair = pairLine(exercises, pairs, view.next);
  } else if (view.kind === "warmup") {
    const setOne = at(setOneOf(view.warmup));
    const handOff = handOffName(exercises, pairs, view.warmup, following);
    if (setOne !== null) {
      const name = spokenName(setOne.exercise);
      label = handOff === null ? { visible: "Opvarmning udført", spoken: `Opvarmning udført, ${name}` } : handOffLabel(handOff, null, name);
    }
    warmupSince = latest !== null && latest.kind === "done" && pairHandOff(exercises, pairs, latest.ref, view.warmup) ? null : view.since;
  }
  let feel: unknown = null;
  if (view.feel !== null) {
    const f = at(view.feel);
    const logged = log.get(setKey(view.feel));
    const shownSet = view.kind === "set" ? at(view.next) : null;
    const named = view.kind === "set" && f !== null && shownSet !== null ? displayName(f.exercise) !== displayName(shownSet.exercise) : true;
    const range = f === null ? null : repsRange(f.exercise.repsText);
    feel = {
      set: ref(view.feel),
      question: f === null ? null : feelQuestion(f, named),
      felt: logged?.feltRpe ?? null,
      range: range === null ? null : [range.low, range.top],
      stepper: range === null ? null : stepperValue(logged?.repsDone, range.top),
    };
  }
  const cl = checklistView([...exercises], order, log);
  return {
    view: norm(view),
    current: ref(shown),
    next: ref(following),
    showRest: view.kind === "set" ? view.showRest : null,
    restWindow,
    restAfterCurrent: shown === null ? null : windowOf(shown), // nextSentence's restRowFor(current)
    label,
    pairLine: pair,
    warmupSince: tapIndex(warmupSince),
    feel,
    progress: progress(order, log),
    lastTap: latest === null ? null : { ref: setKey(latest.ref), kind: latest.kind, at: tapIndex(latest.at) },
    restStart: tapIndex(restStart(log)),
    begun: norm(begunWarmup(order, log)),
    checklist: {
      groups: cl.groups.map((g) => [g.exercise.row, g.closed, g.isNext, g.sets.map((l) => `${setKey(l.ref)}:${l.n}/${l.of}:${l.state}:${tapIndex(l.endedAt) ?? "-"}${l.next ? ":next" : ""}`).join(" ")]),
      segments: cl.segments.join(" "),
      bars: cl.bars.map((b) => `${b.name}:${b.state}`).join(" "),
      first: ref(cl.first),
      beginAt: ref(cl.beginAt),
      primary: cl.primary,
    },
  };
}

// ---------------------------------------------------------------- the server: an in-memory PostgREST

type Row = Record<string, unknown>;
type FakeDb = { tables: Record<string, Row[]> };
const PK = ["date", "session_no", "row_no", "set_no"];

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
    const [op, ...rest] = expression.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null" && row[column] !== null && row[column] !== undefined) return false;
    if (op === "is" && value === "false" && row[column] !== false) return false;
    if (op === "eq" && String(row[column]) !== value) return false;
  }
  return true;
}

function fakeDb(s: Session): FakeDb {
  return {
    tables: {
      strength_sets: s.exercises.flatMap((e) =>
        e.sets.map((r) => ({ week_start: DATE, session: 1, sheet_row: r.row, set_no: r.set, name: e.name, reps_text: e.repsText, variant_id: e.variantId })),
      ),
      exercises: Object.entries(EXERCISE_IDS).map(([name, id]) => ({ id, name, aliases: [] })),
      exercise_set_log: [],
      superset_pairs: s.pairs.map((p) => ({
        date: DATE,
        session_no: 1,
        row_a: p.rowA,
        row_b: p.rowB,
        exercise_a: EXERCISE_IDS[s.exercises.find((e) => e.row === p.rowA)?.name ?? ""],
        variant_a: null,
        exercise_b: EXERCISE_IDS[s.exercises.find((e) => e.row === p.rowB)?.name ?? ""],
        variant_b: null,
        paired: true,
        updated_at: "2026-10-12T07:00:00.000Z",
      })),
    },
  };
}

function fetchFor(db: FakeDb): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop() ?? "";
    const method = init.method ?? "GET";
    const rows = db.tables[table];
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Row) : {};
    if (method === "GET") {
      const columns = (parsed.searchParams.get("select") ?? "").split(",");
      const found = rows.filter((r) => matches(r, parsed.searchParams)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      const range = found.length ? `0-${found.length - 1}/${found.length}` : "*/0";
      return new Response(JSON.stringify(found), { headers: { "Content-Range": range } });
    }
    if (method === "POST") {
      if (!rows.some((r) => PK.every((k) => r[k] === body[k]))) rows.push({ started_at: null, ended_at: null, skipped: false, felt_rpe: null, reps_done: null, ...body });
    } else if (method === "PATCH") {
      for (const r of rows.filter((x) => matches(x, parsed.searchParams))) Object.assign(r, body);
    } else if (method === "DELETE") {
      db.tables[table] = rows.filter((r) => !matches(r, parsed.searchParams));
    }
    return new Response(null, { status: 201 });
  };
}

function options(db: FakeDb): RecordOptions {
  return { env: {}, nodeEnv: "production", client: () => createClient("https://fake.supabase.co", "sb_secret_fake", fetchFor(db)) };
}

// ---------------------------------------------------------------- client log vs server rows

type Cells = { started: string | null; ended: string | null; skipped: boolean; updated: string | null; felt: number | null; reps: number | null };

function clientCells(l: LoggedSet): Cells {
  return { started: tapIndex(l.startedAt), ended: tapIndex(l.endedAt), skipped: l.skipped, updated: tapIndex(l.updatedAt), felt: l.feltRpe ?? null, reps: l.repsDone ?? null };
}

function serverCells(r: Row): Cells {
  return {
    started: tapIndex(r.started_at as string | null),
    ended: tapIndex(r.ended_at as string | null),
    skipped: r.skipped === true,
    updated: tapIndex(r.updated_at as string | null),
    felt: (r.felt_rpe as number | null | undefined) ?? null,
    reps: (r.reps_done as number | null | undefined) ?? null,
  };
}

const cellText = (c: Cells | null) => (c === null ? "-" : `s=${c.started ?? "-"} e=${c.ended ?? "-"} k=${c.skipped ? 1 : 0} u=${c.updated ?? "-"} f=${c.felt ?? "-"} r=${c.reps ?? "-"}`);

function serverRows(db: FakeDb): Map<string, Row> {
  return new Map(db.tables.exercise_set_log.map((r) => [`${String(r.row_no)}#${String(r.set_no)}`, r]));
}

/** Per set key, the fields where the client's optimistic log and the stored row disagree. */
function diffOf(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>, rows: ReadonlyMap<string, Row>): string[] {
  const out: string[] = [];
  for (const r of order) {
    const k = setKey(r);
    const c = log.get(k);
    const s = rows.get(k);
    if (c === undefined && s === undefined) continue;
    if (c === undefined || s === undefined) {
      out.push(`${k}: client ${c === undefined ? "none" : cellText(clientCells(c))} | server ${s === undefined ? "none" : cellText(serverCells(s))}`);
      continue;
    }
    const a = clientCells(c);
    const b = serverCells(s);
    for (const f of Object.keys(a) as (keyof Cells)[]) if (a[f] !== b[f]) out.push(`${k}.${f}: client ${String(a[f])} | server ${String(b[f])}`);
  }
  return out;
}

// ---------------------------------------------------------------- taps the screens can send

type Tap = { readonly kind: SetTapKind; readonly ref: SetRef; readonly value: number | null; readonly label: string };

function feelTarget(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): SetRef | null {
  return fokusView(order, log).feel;
}

/** One named op on the current client state; null when the screens don't offer it now. */
function op(s: Session, order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>, name: string): Tap | null {
  const view = fokusView(order, log, (a, n) => pairHandOff(s.exercises, s.pairs, a, n));
  const shown = view.kind === "set" ? view.next : view.kind === "warmup" ? view.warmup : null;
  const [what, arg] = name.split(":");
  switch (what) {
    case "begin": {
      const at = checklistView([...s.exercises], order, log).beginAt; // Begynd / Fortsæt
      return at === null ? null : { kind: "begin", ref: at, value: null, label: name };
    }
    case "done":
      return shown === null ? null : { kind: "done", ref: shown, value: null, label: name };
    case "skip":
      return view.kind !== "set" ? null : { kind: "skip", ref: view.next, value: null, label: name };
    case "fortryd": {
      const last = lastTap(log);
      if (last !== null) return { kind: "undo", ref: last.ref, value: null, label: name };
      const begun = begunWarmup(order, log);
      return begun === null ? null : { kind: "undo", ref: begun.ref, value: null, label: name };
    }
    case "feel": {
      const f = feelTarget(order, log);
      if (f === null) return null;
      const chosen = Number(arg) as -1 | 0 | 1;
      return { kind: "feel", ref: f, value: nextFeel(log.get(setKey(f))?.feltRpe, chosen), label: name };
    }
    case "reps": {
      const f = feelTarget(order, log);
      const e = f === null ? undefined : s.exercises.find((x) => x.row === f.row);
      const range = e === undefined ? null : repsRange(e.repsText);
      if (f === null || range === null) return null; // the stepper shows on a range set only
      return { kind: "reps", ref: f, value: range.top + Number(arg), label: name };
    }
    case "tick":
    case "untick": {
      const [row, set] = arg.split("#").map(Number);
      const r = { row, set };
      const st = stateOf(log.get(setKey(r)));
      if (what === "tick") return st === "done" ? null : { kind: "done", ref: r, value: null, label: name };
      return st !== "done" ? null : { kind: "undo", ref: r, value: null, label: name };
    }
  }
  throw new Error(`unknown op ${name}`);
}

/** Every op the screens offer now (for the seeded sequences). */
function offered(s: Session, order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): Tap[] {
  const names = ["begin", "done", "done", "skip", "fortryd", "feel:-1", "feel:0", "feel:1", "reps:-2", "reps:-1", "reps:1"];
  for (const r of order) if (!isWarmup(r)) names.push(`tick:${setKey(r)}`, `untick:${setKey(r)}`);
  return names.map((n) => op(s, order, log, n)).filter((t): t is Tap => t !== null);
}

// ---------------------------------------------------------------- running a sequence

type Step = Record<string, unknown>;

async function run(s: Session, pick: (log: ReadonlyMap<string, LoggedSet>, i: number) => Tap | null | "stop", maxSteps: number) {
  const order = orderOf(s);
  const db = fakeDb(s);
  let log: ReadonlyMap<string, LoggedSet> = new Map();
  const steps: Step[] = [{ tap: null, facts: screenFacts(s, order, log), server: [], diff: [] }];
  for (let i = 1; i <= maxSteps; i += 1) {
    const tap = pick(log, i);
    if (tap === "stop") break;
    if (tap === null) {
      steps.push({ tap: "(not offered)" });
      continue;
    }
    const at = new Date(DAY0 + i * 60_000);
    const undoes: Undoes | null = tap.kind === "undo" ? (undoesOf(log, tap.ref) ?? "done") : null; // as useSetLog
    const result = await recordSetTap({ kind: tap.kind, date: DATE, session: 1, row: tap.ref.row, set: tap.ref.set, undoes, value: tap.value }, at, options(db));
    log = applyTap(order, log, tap.kind, tap.ref, at.toISOString(), tap.value);
    const rows = serverRows(db);
    steps.push({
      tap: `${tap.label} -> ${tap.kind} ${setKey(tap.ref)}${tap.value === null ? "" : ` ${tap.value}`}${undoes === null ? "" : ` undoes=${undoes}`}`,
      result: result.ok ? "ok" : result.reason,
      facts: screenFacts(s, order, log),
      server: order.flatMap((r) => {
        const row = rows.get(setKey(r));
        return row === undefined ? [] : [`${setKey(r)} ${String(row.kind)} x${String(row.exercise_id)} ${cellText(serverCells(row))}`];
      }),
      diff: diffOf(order, log, rows),
    });
  }
  return { session: s.name, order: order.map(setKey).join(" "), steps };
}

function scripted(s: Session, ops: readonly string[]) {
  return run(s, (log, i) => (i > ops.length ? "stop" : op(s, orderOf(s), log, ops[i - 1])), ops.length);
}

/** done (and an optional feel) until the session is finished. */
function walk(s: Session, feelEvery: number) {
  let n = 0;
  return run(
    s,
    (log) => {
      const order = orderOf(s);
      n += 1;
      if (firstOpen(order, log) === null) return "stop";
      if (feelEvery > 0 && n % feelEvery === 0) {
        const f = op(s, order, log, "feel:1");
        if (f !== null) return f;
      }
      return op(s, order, log, "done");
    },
    80,
  );
}

/** A fixed-seed LCG (Numerical Recipes constants): no dependency, the same stream on every machine. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function seeded(s: Session, seed: number) {
  const rnd = lcg(seed);
  const length = 10 + Math.floor(rnd() * 21); // 10..30 taps
  return run(
    s,
    (log) => {
      const taps = offered(s, orderOf(s), log);
      return taps.length === 0 ? "stop" : taps[Math.floor(rnd() * taps.length)];
    },
    length,
  );
}

async function record() {
  const sequences: unknown[] = [];
  const add = async (name: string, p: Promise<unknown>) => sequences.push({ name, ...(await p as object) });
  for (const s of SESSIONS) {
    const n = s.name;
    await add(`${n}: begin`, scripted(s, ["begin"]));
    await add(`${n}: begin, undo begin`, scripted(s, ["begin", "fortryd"]));
    await add(`${n}: warm-up done, set done, undo done`, scripted(s, ["begin", "done", "done", "fortryd"]));
    await add(`${n}: skip, undo skip`, scripted(s, ["begin", "done", "skip", "fortryd"]));
    await add(`${n}: done, feel each value, clear`, scripted(s, ["begin", "done", "done", "feel:1", "feel:-1", "feel:-1", "feel:0"]));
    await add(`${n}: overview ticks out of order, untick`, scripted(s, [`tick:${setKey(s.exercises[1].sets[1])}`, `tick:${setKey(s.exercises[0].sets[0])}`, "done", `untick:${setKey(s.exercises[1].sets[1])}`, "fortryd"]));
    await add(`${n}: walk the session`, walk(s, 0));
    await add(`${n}: walk the session with a feel every 3rd tap`, walk(s, 3));
  }
  // A range set: its done, a reps tap, a feel, undo of the done (PLAIN row 11 "8 - 12").
  await add("plain: range set reps tap, feel, undo done", scripted(PLAIN, ["tick:10#1", "tick:10#2", "tick:10#3", "done", "done", "reps:-2", "feel:1", "reps:1", "fortryd"]));
  await add("plain: skip every set", run(PLAIN, (log) => (firstOpen(orderOf(PLAIN), log) === null ? "stop" : (op(PLAIN, orderOf(PLAIN), log, "skip") ?? op(PLAIN, orderOf(PLAIN), log, "done"))), 80));
  await add("plain: begin after a tick, undo begin", scripted(PLAIN, ["tick:11#1", "begin", "fortryd", "fortryd"]));
  await add("superset-3+3: reps on B, undo B's done", scripted(SESSIONS[1], ["begin", "done", "done", "done", "done", "reps:-1", "fortryd"]));
  for (let seed = 1; seed <= 40; seed += 1) {
    const s = SESSIONS[seed % SESSIONS.length];
    await add(`seed ${seed} (${s.name})`, seeded(s, seed));
  }
  return { note: "Generated by tests/fokus-golden.test.ts; REGENERATE_FOKUS_GOLDEN=1 pnpm test rewrites it.", sequences };
}

/** One step per line, so a changed fact shows as one changed line in a diff. */
function serialise(golden: { note: string; sequences: unknown[] }): string {
  const seqs = golden.sequences.map((q) => {
    const { steps, ...head } = q as { steps: unknown[] };
    const inner = steps.map((st) => `      ${JSON.stringify(st)}`).join(",\n");
    const top = JSON.stringify(head).slice(0, -1);
    return `  ${top},"steps":[\n${inner}\n  ]}`;
  });
  return `{"note":${JSON.stringify(golden.note)},"sequences":[\n${seqs.join(",\n")}\n]}\n`;
}

console.error = () => {}; // recordSetTap logs refused saves; the result is in the snapshot

test("golden: Fokus/Træning facts and stored set-log rows after every tap match fixtures/fokus-golden.json", async () => {
  const golden = await record();
  const text = serialise(golden);
  if (process.env.REGENERATE_FOKUS_GOLDEN === "1") {
    writeFileSync(GOLDEN, text);
    return;
  }
  assert.ok(existsSync(GOLDEN), "fixtures/fokus-golden.json is missing: REGENERATE_FOKUS_GOLDEN=1 pnpm test");
  const expected: unknown = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.deepStrictEqual(JSON.parse(text), expected);
});
