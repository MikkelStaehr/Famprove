import "server-only";

import { isoWeekStart } from "../dates.ts";
import { neighbours, sessionOrder, setKey, type SetRef, type SetTapInput } from "../set-taps.ts";
import { localToday } from "../today-view.ts";
import { devFixture } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import {
  createClient,
  type Filter,
  type PostgrestClient,
  PostgrestError,
  selectAll,
  selectFirst,
  write,
} from "./postgrest.ts";
import { RowError } from "./rows.ts";

/**
 * The app's only write path: public.exercise_set_log, from the Træning screens' taps via the
 * server action in app/actions.ts (rules in lib/set-taps.ts). Server-side only with the service
 * key; the deployment is behind Vercel Authentication, and every input is checked here:
 *  - the date must be today (Copenhagen); dev switches (DEV_TODAY, DEV_FIXTURE) write nothing;
 *  - the set must be in that ISO week's session of the sheet (strength_sets), and its exercise
 *    must resolve in public.exercises (name or alias, trimmed, case-insensitive);
 *  - next / previous set come from the sheet's order here, never from the client;
 *  - timestamps are this server's clock; one tap writes one value T everywhere, which is how an
 *    undo finds what its tap wrote (it clears a field only while it still holds T).
 * Python never reads this table; nothing computes from it; the app never writes kg.
 */

export type SetTapResult =
  | { readonly ok: true; readonly at: string } // at: the server time of the tap
  | { readonly ok: false; readonly reason: "dev" | "invalid" | "failed" };

const LOG = "exercise_set_log";
type Field = "started_at" | "ended_at";
type Logged = {
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly skipped: boolean;
  readonly updatedAt: string;
};
type Key = { readonly date: string; readonly session: number; readonly ref: SetRef; readonly exerciseId: number };

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

function record(raw: unknown, table: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new RowError(`${table}: a row must be an object`);
  return raw as Record<string, unknown>; // a PostgREST row object, narrowed field by field
}

function textOrNull(r: Record<string, unknown>, column: string): string | null {
  const value = r[column];
  if (value === null || typeof value === "string") return value;
  throw new RowError(`${LOG}.${column} must be text or null`);
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

async function read(c: PostgrestClient, k: Key): Promise<Logged | null> {
  return selectFirst(
    c,
    LOG,
    { columns: "started_at,ended_at,skipped,updated_at", order: "date", filters: keyParams(k) },
    (raw) => {
      const r = record(raw, LOG);
      if (typeof r.skipped !== "boolean" || typeof r.updated_at !== "string") {
        throw new RowError(`${LOG} row must have skipped and updated_at`);
      }
      return {
        startedAt: textOrNull(r, "started_at"),
        endedAt: textOrNull(r, "ended_at"),
        skipped: r.skipped,
        updatedAt: r.updated_at,
      };
    },
  );
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

async function deleteIfEmpty(c: PostgrestClient, k: Key): Promise<void> {
  await write(c, LOG, "DELETE", {
    params: [...keyParams(k), ["started_at", "is.null"], ["ended_at", "is.null"], ["skipped", "is.false"]],
  });
}

function sameInstant(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && Date.parse(a) === Date.parse(b);
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
    const { previous, next } = neighbours(order, target);
    const after = keyOf(next); // null: the last set (or an exercise the catalogue doesn't know)
    const before = keyOf(previous);
    const at = now.toISOString();
    const logged = await read(c, own);
    switch (input.kind) {
      case "begin":
        if (logged?.skipped !== true) await setIfNull(c, own, ["started_at"], at);
        break;
      case "done":
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
        if (logged === null) break;
        if (logged.skipped) {
          // The skip wrote no time on this set; the next set's start holds the skip's time.
          const restored = before === null ? null : ((await read(c, before))?.endedAt ?? null);
          await patch(c, own, [], { skipped: false, started_at: restored, updated_at: at });
          if (after !== null) {
            await patch(c, after, [["started_at", `eq.${logged.updatedAt}`]], { started_at: null, updated_at: at });
            await deleteIfEmpty(c, after);
          }
        } else if (logged.endedAt !== null) {
          const t = logged.endedAt;
          await patch(c, own, [["ended_at", `eq.${t}`]], { ended_at: null, updated_at: at });
          await patch(c, own, [["started_at", `eq.${t}`]], { started_at: null, updated_at: at });
          if (after !== null) {
            await patch(c, after, [["started_at", `eq.${t}`]], { started_at: null, updated_at: at });
            await deleteIfEmpty(c, after);
          }
        } else if (logged.startedAt !== null) {
          // A begin: undone unless the previous set's end wrote this start.
          const previousEnd = before === null ? null : ((await read(c, before))?.endedAt ?? null);
          if (!sameInstant(previousEnd, logged.startedAt)) {
            await patch(c, own, [["started_at", `eq.${logged.startedAt}`]], { started_at: null, updated_at: at });
          }
        }
        await deleteIfEmpty(c, own);
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
