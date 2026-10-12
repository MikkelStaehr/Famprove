import "server-only";

import { isoWeekStart } from "../dates.ts";
import {
  type LoggedSet,
  neighbours,
  nextOpen,
  refused,
  sameInstant,
  sessionOrder,
  setKey,
  type SetRef,
  type SetTapInput,
  startAfter,
  stateOf,
} from "../set-taps.ts";
import { localToday } from "../today-view.ts";
import { devFixture } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import {
  createClient,
  type Filter,
  type PostgrestClient,
  PostgrestError,
  selectAll,
  write,
} from "./postgrest.ts";
import { parseSetLogRow, RowError, SET_LOG_SELECT } from "./rows.ts";

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
 * Python never reads this table; nothing computes from it; the app never writes kg.
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

/** The session's sets in the sheet (row, set, exercise name). */
async function sessionSets(c: PostgrestClient, weekStart: string, session: number) {
  return selectAll(
    c,
    "strength_sets",
    {
      columns: "sheet_row,set_no,name",
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
      return { ref: { row: r.sheet_row, set: r.set_no }, name: r.name };
    },
  );
}

/** public.exercises id per name and alias key; a canonical name wins over another's alias. */
async function exerciseIds(c: PostgrestClient): Promise<Map<string, number>> {
  const rows = await selectAll(c, "exercises", { columns: "id,name,aliases", order: "id" }, (raw) => {
    const r = record(raw, "exercises");
    if (typeof r.id !== "number" || typeof r.name !== "string" || !Array.isArray(r.aliases)) {
      throw new RowError("exercises row must have id, name and aliases");
    }
    return { id: r.id, name: r.name, aliases: r.aliases.filter((a) => typeof a === "string") };
  });
  const ids = new Map<string, number>();
  for (const e of rows) if (!ids.has(nameKey(e.name))) ids.set(nameKey(e.name), e.id);
  for (const e of rows) for (const a of e.aliases) if (!ids.has(nameKey(a))) ids.set(nameKey(a), e.id);
  return ids;
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

/** Under `next dev` with DEV_TODAY or DEV_FIXTURE the screen is not today's: write nothing. */
function devSwitchOn(env: Readonly<Record<string, string | undefined>>, nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" && (Boolean(env.DEV_TODAY) || devFixture(env, nodeEnv) !== null);
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
    const names = new Map(sets.map((s) => [setKey(s.ref), s.name]));
    const order = sessionOrder(sets.map((s) => s.ref));
    const target = { row: input.row, set: input.set };
    const keyOf = (ref: SetRef | null): Key | null => {
      if (ref === null) return null;
      const id = ids.get(nameKey(names.get(setKey(ref)) ?? ""));
      return id === undefined ? null : { date: input.date, session: input.session, ref, exerciseId: id };
    };
    const own = keyOf(names.has(setKey(target)) ? target : null);
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
      case "done":
        if (stateOf(logged) === "done") break; // first write wins
        if (logged?.skipped === true) await patch(c, own, [], { skipped: false, updated_at: at });
        await setIfNull(c, own, ["started_at", "ended_at"], at);
        if (after !== null) await setIfNull(c, after, ["started_at"], at);
        break;
      case "skip":
        await ensure(c, own, { skipped: true }, at);
        await patch(c, own, [], { skipped: true, started_at: null, ended_at: null, updated_at: at });
        if (after !== null) await setIfNull(c, after, ["started_at"], at);
        break;
      case "undo": {
        if (logged === undefined) break;
        const previousLogged = previous === null ? undefined : log.get(setKey(previous));
        if (logged.skipped) {
          // The skip wrote no time on this set: its start comes back from the previous set.
          await patch(c, own, [], { skipped: false, started_at: startAfter(previousLogged), updated_at: at });
          await clearStarts(c, input.date, input.session, logged.updatedAt ?? at, at);
        } else if (logged.endedAt !== null) {
          await patch(c, own, [["ended_at", `eq.${logged.endedAt}`]], { ended_at: null, updated_at: at });
          await clearStarts(c, input.date, input.session, logged.endedAt, at);
        } else if (logged.startedAt !== null && !sameInstant(startAfter(previousLogged), logged.startedAt)) {
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
