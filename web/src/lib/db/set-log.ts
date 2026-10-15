import "server-only";

import { isoWeekStart } from "../dates.ts";
import {
  type LoggedSet,
  neighbours,
  nextOpen,
  isWarmup,
  refused,
  sessionOrderWithWarmups,
  setKey,
  type SetRef,
  type SetTapInput,
  startAfter,
  startFromAnotherTap,
  stateOf,
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
  parseSetLogRow,
  parseSupersetPairRow,
  RowError,
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
type Field = "started_at" | "ended_at";
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

/** The top of a range prescription ("8 - 12" -> 12); null for fixed reps ("3") or none. */
export function rangeTop(repsText: string | null): number | null {
  // As Python's domain.set_feedback.range_top: whole or decimal ends, comma or dot.
  const m = repsText === null ? null : /^\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/.exec(repsText);
  if (m === null) return null;
  const end = (s: string | undefined) => Number((s ?? "").replace(",", "."));
  return Math.max(end(m[1]), end(m[2]));
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

/** Sets `fields` to `at` where they are null (first write wins), unless the set is skipped. */
async function setIfNull(c: PostgrestClient, k: Key, fields: readonly Field[], at: string): Promise<void> {
  await ensure(c, k, Object.fromEntries(fields.map((f) => [f, at])), at);
  for (const field of fields) {
    await patch(c, k, [[field, "is.null"], ["skipped", "is.false"]], { [field]: at, updated_at: at });
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
    const runs = sessionRuns(sets, ids);
    const pairRows = await sessionPairRows(c, input.date, input.session, runs);
    const order = sessionOrderWithWarmups(sets, effectivePairs(runs, pairRows.today, pairRows.history));
    const inOrder = new Set(order.map(setKey)); // the sheet's sets and their exercises' warm-ups
    const names = new Map(sets.map((s) => [setKey(s.ref), s.name]));
    const tops = new Map(sets.map((s) => [setKey(s.ref), rangeTop(s.repsText)]));
    const nameOf = (ref: SetRef) => names.get(setKey(isWarmup(ref) ? { row: ref.row, set: 1 } : ref)) ?? "";
    const target = { row: input.row, set: input.set };
    const keyOf = (ref: SetRef | null): Key | null => {
      if (ref === null) return null;
      const id = ids.get(nameKey(nameOf(ref)));
      return id === undefined ? null : { date: input.date, session: input.session, ref, exerciseId: id };
    };
    const own = keyOf(inOrder.has(setKey(target)) ? target : null);
    if (own === null) return { ok: false, reason: "invalid" }; // not in the session, or unknown
    const log = await sessionLog(c, input.date, input.session);
    if (refused(log, input.kind, target)) return { ok: false, reason: "invalid" }; // skip a done set
    const logged = log.get(setKey(target));
    const { previous } = neighbours(order, target);
    const after = keyOf(nextOpen(order, log, target)); // null: no open set after it
    const at = now.toISOString();
    switch (input.kind) {
      case "begin":
        if (stateOf(logged) === "open") await setIfNull(c, own, ["started_at"], at);
        break;
      case "done": {
        // A retry of a done that already landed (partly) finishes it with the tap's own time, so
        // one tap keeps one T everywhere (undo finds it) and the next set still gets its start.
        const t = stateOf(logged) === "done" && logged?.endedAt != null ? logged.endedAt : at;
        if (logged?.skipped === true) await patch(c, own, [], { skipped: false, updated_at: at });
        const top = tops.get(setKey(target)) ?? null; // a range set: its reps default to the top
        if (top !== null && logged?.repsDone == null) {
          await ensure(c, own, { reps_done: top }, t);
          await patch(c, own, [["reps_done", "is.null"]], { reps_done: top });
        }
        await setIfNull(c, own, ["started_at", "ended_at"], t);
        if (after !== null) await setIfNull(c, after, ["started_at"], t);
        break;
      }
      case "skip": {
        // As done: a retry reuses the skip's own time (its updated_at) for the next set's start.
        const t = logged?.skipped === true && logged.updatedAt !== null ? logged.updatedAt : at;
        if (logged?.skipped !== true) {
          await ensure(c, own, { skipped: true }, t);
          await patch(c, own, [], { skipped: true, started_at: null, ended_at: null, updated_at: t });
        }
        if (after !== null) await setIfNull(c, after, ["started_at"], t);
        break;
      }
      case "feel":
        // One column on a done set (refused above otherwise): -1 / 0 / +1, or null to clear.
        await patch(c, own, [], { felt_rpe: input.value ?? null, updated_at: at });
        break;
      case "reps": {
        // A range set only, within 1 .. top + 10 (spec fokus-pause.md).
        const top = tops.get(setKey(target)) ?? null;
        const reps = input.value ?? null;
        if (top === null || reps === null || reps < 1 || reps > top + 10) return { ok: false, reason: "invalid" };
        await patch(c, own, [], { reps_done: reps, updated_at: at });
        break;
      }
      case "undo": {
        // Applied only while the set is still what the client undid (input.undoes); otherwise this
        // is a retry of an undo that already landed, and only the cleanup is left. The tap's own
        // mark (the set's end, or its skip) is cleared last, so a partial undo is finished by its retry.
        const state = logged === undefined ? null : logged.skipped ? "skip" : logged.endedAt !== null ? "done" : "begin";
        if (logged !== undefined && input.undoes === "skip" && state === "skip") {
          const previousLogged = previous === null ? undefined : log.get(setKey(previous));
          await clearStarts(c, input.date, input.session, logged.updatedAt ?? at, at); // the starts the skip wrote
          await patch(c, own, [], { skipped: false, started_at: startAfter(previousLogged), updated_at: at });
        } else if (logged?.endedAt != null && input.undoes === "done" && state === "done") {
          const t = logged.endedAt;
          await clearStarts(c, input.date, input.session, t, at); // on sets that aren't done
          await patch(c, own, [["started_at", `eq.${t}`], ["ended_at", `eq.${t}`]], { started_at: null, updated_at: at });
          // The set is open again: its rating and reps done go with its end (one request).
          await patch(c, own, [["ended_at", `eq.${t}`]], { ended_at: null, felt_rpe: null, reps_done: null, updated_at: at });
        } else if (
          logged?.startedAt != null &&
          input.undoes === "begin" &&
          state === "begin" &&
          !startFromAnotherTap(log, target, logged.startedAt)
        ) {
          await clearStarts(c, input.date, input.session, logged.startedAt, at); // a begin
        }
        await deleteEmpty(c, input.date, input.session);
        break;
      }
    }
    return { ok: true, at };
  } catch (error) {
    if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
      console.error("exercise_set_log: tap not saved", error.message);
      return { ok: false, reason: "failed" };
    }
    throw error;
  }
}
