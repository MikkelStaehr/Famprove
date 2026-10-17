import "server-only";

import { isoWeekStart } from "../dates.ts";
import {
  type Change,
  type Guard,
  type LoggedSet,
  isWarmup,
  type LogValues,
  rangeTops,
  type SessionShape,
  setKey,
  type SetRef,
  type SetTapInput,
  shapeOrder,
  transition,
} from "../set-taps.ts";
import { effectivePairs, exerciseIdMap, type SessionRun, sessionRuns } from "../supersets.ts";
import { localToday } from "../training-view.ts";
import { devSwitchOn } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import {
  createClient,
  type Filter,
  type PostgrestClient,
  PostgrestError,
  selectAll,
  write,
} from "./postgrest.ts";
import {
  parseSessionOrderRow,
  parseSetLogRow,
  parseSupersetPairRow,
  RowError,
  SESSION_ORDER_SELECT,
  SET_LOG_SELECT,
  SUPERSET_PAIRS_SELECT,
  type SupersetPairRow,
} from "./rows.ts";

/**
 * The app's only write path: public.exercise_set_log, from the Træning screens' taps via the
 * server action in app/actions.ts (rules in lib/set-taps.ts). Server-side only with the service
 * key; the deployment is behind Vercel Authentication, and every input is checked here:
 *  - the date must be today (Copenhagen); dev switches (DEV_TODAY, DEV_FIXTURE) write nothing;
 *  - the set must be in that ISO week's session of the sheet (strength_sets), and its exercise
 *    must resolve in public.exercises (name or alias, trimmed, case-insensitive);
 *  - the next open set and the previous set come from the sheet's order and the session's log
 *    here, never from the client;
 *  - timestamps are this server's clock; one tap writes one value T everywhere, which is how an
 *    undo finds what its tap wrote (it clears a start only while it holds T, on a set not done).
 * Warm-ups are set 0 of an exercise run's first row (kind 'warmup') and follow the same rules
 * in the order (lib/set-taps.ts). feel and reps write one column on a done set; a done on a range
 * set writes the top of the range as reps_done when it is empty (the stepper adjusts it).
 * Python reads felt_rpe and reps_done (since 2026-10-13); the app never writes kg.
 */

export type SetTapResult =
  | { readonly ok: true; readonly at: string } // at: the server time of the tap
  | { readonly ok: false; readonly reason: "dev" | "invalid" | "failed" };

const LOG = "exercise_set_log";
type Key = { readonly date: string; readonly session: number; readonly ref: SetRef; readonly exerciseId: number };

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

function record(raw: unknown, table: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new RowError(`${table}: a row must be an object`);
  return raw as Record<string, unknown>; // a PostgREST row object, narrowed field by field
}

function nameKey(name: string): string {
  return name.trim().toLowerCase(); // as public.exercises' lower(btrim(name))
}

/** The session's sets in the sheet (row, set, exercise name, variant, reps as written). */
export async function sessionSets(c: PostgrestClient, weekStart: string, session: number) {
  return selectAll(
    c,
    "strength_sets",
    {
      columns: "sheet_row,set_no,name,reps_text,variant_id",
      order: "sheet_id,block,sheet_row,week,set_no",
      filters: [
        ["week_start", `eq.${weekStart}`],
        ["session", `eq.${session}`],
      ],
    },
    (raw) => {
      const r = record(raw, "strength_sets");
      if (typeof r.sheet_row !== "number" || typeof r.set_no !== "number" || typeof r.name !== "string") {
        throw new RowError("strength_sets row must have sheet_row, set_no and name");
      }
      const repsText = typeof r.reps_text === "string" ? r.reps_text : null;
      if (r.variant_id !== null && r.variant_id !== undefined && typeof r.variant_id !== "number") {
        throw new RowError("strength_sets.variant_id must be a number or null");
      }
      const variantId = typeof r.variant_id === "number" ? r.variant_id : null; // null = ukendt
      return { ref: { row: r.sheet_row, set: r.set_no }, name: r.name, repsText, variantId };
    },
  );
}

/** public.exercises id per name and alias key; a canonical name wins over another's alias. */
export async function exerciseIds(c: PostgrestClient): Promise<Map<string, number>> {
  const rows = await selectAll(c, "exercises", { columns: "id,name,aliases", order: "id" }, (raw) => {
    const r = record(raw, "exercises");
    if (typeof r.id !== "number" || typeof r.name !== "string" || !Array.isArray(r.aliases)) {
      throw new RowError("exercises row must have id, name and aliases");
    }
    return { id: r.id, name: r.name, aliases: r.aliases.filter((a) => typeof a === "string") };
  });
  return exerciseIdMap(rows);
}

/**
 * The superset rows that decide a session's pairs: today's rows of the session, and earlier days'
 * rows whose exercises are both in the session (one query; effectivePairs takes the latest per
 * ordered pair).
 */
export async function sessionPairRows(
  c: PostgrestClient,
  date: string,
  session: number,
  runs: readonly SessionRun[],
): Promise<{ readonly today: SupersetPairRow[]; readonly history: SupersetPairRow[] }> {
  const ids = [...new Set(runs.flatMap((r) => (r.exerciseId === null ? [] : [r.exerciseId])))].toSorted((a, b) => a - b);
  if (ids.length === 0) return { today: [], history: [] };
  const list = `in.(${ids.join(",")})`;
  const rows = await selectAll(
    c,
    SUPERSET_PAIRS_SELECT.table,
    { ...SUPERSET_PAIRS_SELECT, filters: [["date", `lte.${date}`], ["exercise_a", list], ["exercise_b", list]] },
    parseSupersetPairRow,
  );
  return {
    today: rows.filter((r) => r.date === date && r.session === session),
    history: rows.filter((r) => r.date < date),
  };
}

/** The session's stored run order (public.session_order); null = none (the sheet's order). */
export async function sessionRunRows(c: PostgrestClient, date: string, session: number): Promise<readonly number[] | null> {
  const rows = await selectAll(
    c,
    SESSION_ORDER_SELECT.table,
    { ...SESSION_ORDER_SELECT, filters: [["date", `eq.${date}`], ["session_no", `eq.${session}`]] },
    parseSessionOrderRow,
  );
  return rows.at(0)?.runRows ?? null;
}

/** The jump's mark: one upsert of the session's run order on the primary key (the last write wins). */
async function writeOrder(c: PostgrestClient, date: string, session: number, runRows: readonly number[], at: string): Promise<void> {
  await write(c, SESSION_ORDER_SELECT.table, "POST", {
    params: [["on_conflict", "date,session_no"]],
    body: { date, session_no: session, run_rows: runRows, updated_at: at },
    prefer: "resolution=merge-duplicates",
  });
}

function keyParams(k: Key): Filter[] {
  return [
    ["date", `eq.${k.date}`],
    ["session_no", `eq.${k.session}`],
    ["row_no", `eq.${k.ref.row}`],
    ["set_no", `eq.${k.ref.set}`],
  ];
}

/** The session's logged sets (the screens read the same rows back). */
async function sessionLog(c: PostgrestClient, date: string, session: number): Promise<Map<string, LoggedSet>> {
  const rows = await selectAll(
    c,
    LOG,
    { ...SET_LOG_SELECT, filters: [["date", `eq.${date}`], ["session_no", `eq.${session}`]] },
    parseSetLogRow,
  );
  return new Map(rows.map((r) => [setKey(r), r]));
}

/** Creates the set's row if needed (with `values`), never overwriting an existing one. */
async function ensure(c: PostgrestClient, k: Key, values: Readonly<Record<string, unknown>>, at: string) {
  await write(c, LOG, "POST", {
    params: [["on_conflict", "date,session_no,row_no,set_no"]],
    body: {
      date: k.date,
      session_no: k.session,
      row_no: k.ref.row,
      set_no: k.ref.set,
      exercise_id: k.exerciseId,
      kind: isWarmup(k.ref) ? "warmup" : "set",
      ...values,
      updated_at: at,
    },
    prefer: "resolution=ignore-duplicates",
  });
}

async function patch(c: PostgrestClient, k: Key, only: readonly Filter[], body: Readonly<Record<string, unknown>>) {
  await write(c, LOG, "PATCH", { params: [...keyParams(k), ...only], body });
}

const COLUMNS: Readonly<Record<keyof LogValues, string>> = {
  startedAt: "started_at",
  endedAt: "ended_at",
  skipped: "skipped",
  skippedAt: "skipped_at",
  feltRpe: "felt_rpe",
  repsDone: "reps_done",
};

// A PostgREST body: each LogValues field under its column name (values are already JSON).
function columns(values: LogValues): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [COLUMNS[field as keyof LogValues], value]));
}

function filterOf(g: Guard): Filter {
  const value = g.equals === null ? "is.null" : typeof g.equals === "boolean" ? `is.${String(g.equals)}` : `eq.${g.equals}`;
  return [COLUMNS[g.field], value];
}

/** One Change as one request (a ref whose exercise isn't in public.exercises is left alone). */
async function send(c: PostgrestClient, date: string, session: number, change: Change, keyOf: (ref: SetRef) => Key | null) {
  switch (change.op) {
    case "ensure": {
      const k = keyOf(change.ref);
      if (k !== null) await ensure(c, k, columns(change.values), change.updatedAt);
      return;
    }
    case "patch": {
      const k = keyOf(change.ref);
      const body = { ...columns(change.values), ...(change.updatedAt === null ? {} : { updated_at: change.updatedAt }) };
      if (k !== null) await patch(c, k, change.when.map(filterOf), body);
      return;
    }
    case "clearStarts":
      return clearStarts(c, date, session, change.t, change.at);
    case "deleteEmpty":
      return deleteEmpty(c, date, session);
    case "order":
      return writeOrder(c, date, session, change.runRows, change.at);
  }
}

/** Deletes the session's rows left with no timestamps and not skipped. */
async function deleteEmpty(c: PostgrestClient, date: string, session: number): Promise<void> {
  await write(c, LOG, "DELETE", {
    params: [
      ["date", `eq.${date}`],
      ["session_no", `eq.${session}`],
      ["started_at", "is.null"],
      ["ended_at", "is.null"],
      ["skipped", "is.false"],
    ],
  });
}

/** Clears every start in the session that holds `t` on a set that isn't done (one tap's T). */
async function clearStarts(c: PostgrestClient, date: string, session: number, t: string, at: string): Promise<void> {
  await write(c, LOG, "PATCH", {
    params: [
      ["date", `eq.${date}`],
      ["session_no", `eq.${session}`],
      ["started_at", `eq.${t}`],
      ["ended_at", "is.null"],
    ],
    body: { started_at: null, updated_at: at },
  });
}

/** Injectable for tests; production reads process.env and uses globalThis.fetch. */
export type RecordOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeEnv?: string;
  readonly client?: () => PostgrestClient;
};

export async function recordSetTap(input: SetTapInput, now: Date, options: RecordOptions = {}): Promise<SetTapResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (devSwitchOn(env, nodeEnv)) return { ok: false, reason: "dev" };
  if (input.date !== localToday(now)) return { ok: false, reason: "invalid" };
  try {
    const c = makeClient();
    const [sets, ids] = await Promise.all([
      sessionSets(c, isoWeekStart(input.date), input.session),
      exerciseIds(c),
    ]);
    // Supersets: the pairs in force reorder the session (A1, B1, A2 ...), as on the screens.
    // A jump's stored run order (session_order) on top, read in the same batch as the pairs.
    const runs = sessionRuns(sets, ids);
    const [pairRows, runRows] = await Promise.all([
      sessionPairRows(c, input.date, input.session, runs),
      sessionRunRows(c, input.date, input.session),
    ]);
    const shape: SessionShape = { sets, pairs: effectivePairs(runs, pairRows.today, pairRows.history), runRows };
    const order = shapeOrder(shape);
    const inOrder = new Set(order.map(setKey)); // the sheet's sets and their exercises' warm-ups
    const names = new Map(sets.map((s) => [setKey(s.ref), s.name]));
    const tops = rangeTops(sets.map((s) => ({ repsText: s.repsText, sets: [s.ref] })));
    const nameOf = (ref: SetRef) => names.get(setKey(isWarmup(ref) ? { row: ref.row, set: 1 } : ref)) ?? "";
    const target = { row: input.row, set: input.set };
    const keyOf = (ref: SetRef | null): Key | null => {
      if (ref === null || !inOrder.has(setKey(ref))) return null;
      const id = ids.get(nameKey(nameOf(ref)));
      return id === undefined ? null : { date: input.date, session: input.session, ref, exerciseId: id };
    };
    // A jump names a run by its first row (transition refuses one that starts no run); any other
    // tap names a set of the session.
    if (input.kind !== "jump" && keyOf(target) === null) return { ok: false, reason: "invalid" }; // not in the session, or unknown
    const log = await sessionLog(c, input.date, input.session);
    const at = now.toISOString();
    // The rules are lib/set-taps.ts transition's (the client applies the same Changes); each
    // Change is one conditional request, sent in order, so a retry finishes a partly landed tap.
    const tap = { kind: input.kind, target, undoes: input.undoes, value: input.value ?? null };
    const changes = transition(order, log, tap, at, tops, shape);
    if (changes === null) return { ok: false, reason: "invalid" }; // e.g. skip a done set
    for (const change of changes) await send(c, input.date, input.session, change, keyOf);
    return { ok: true, at };
  } catch (error) {
    if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
      console.error("exercise_set_log: tap not saved", error.message);
      return { ok: false, reason: "failed" };
    }
    throw error;
  }
}
