import "server-only";

import { isoWeekStart } from "../dates.ts";
import { exerciseKey, type TapInput } from "../exercise-taps.ts";
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
 * The app's only write path: public.exercise_log, from Today's ticks via the server action in
 * app/actions.ts (rules in lib/exercise-taps.ts). Server-side only with the service key; the
 * deployment is behind Vercel Authentication, and the action checks every input here:
 *  - the date must be today (Copenhagen), and dev switches (DEV_TODAY, DEV_FIXTURE) write nothing;
 *  - every name must be in that ISO week's session of the sheet (strength_sets) and resolve in
 *    public.exercises (name or alias, trimmed, case-insensitive);
 *  - timestamps are this server's clock; every field one tap writes holds that tap's timestamp,
 *    returned as `at` only when the tap wrote something (first write wins). An undo sends that
 *    `at` back and clears only fields that still hold it, so an undo of a tap that wrote nothing
 *    (a re-tick after a reload) changes nothing.
 * Python never reads this table; nothing computes from it.
 */

export type TapResult =
  | { readonly ok: true; readonly at: string | null } // at: what a start / end tap wrote, if anything
  | { readonly ok: false; readonly reason: "dev" | "invalid" | "failed" };

const LOG = "exercise_log";
type Field = "started_at" | "ended_at";
type LogRow = { readonly startedAt: string | null; readonly endedAt: string | null };

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

function text(raw: unknown, column: string): string | null {
  const value = (raw as Record<string, unknown>)[column]; // a PostgREST row object
  if (value === null || typeof value === "string") return value;
  throw new RowError(`${LOG}.${column} must be text or null`);
}

/** Exercise names (keys) of one session of the sheet: the names a tap may refer to. */
async function sessionNames(c: PostgrestClient, weekStart: string, session: number): Promise<Set<string>> {
  const names = await selectAll(
    c,
    "strength_sets",
    {
      columns: "name",
      order: "sheet_id,block,sheet_row,week,set_no",
      filters: [
        ["week_start", `eq.${weekStart}`],
        ["session", `eq.${session}`],
      ],
    },
    (raw) => text(raw, "name") ?? "",
  );
  return new Set(names.map(exerciseKey));
}

/** public.exercises id per name and alias key. A canonical name wins over another's alias. */
async function exerciseIds(c: PostgrestClient): Promise<Map<string, number>> {
  type Entry = { readonly id: number; readonly name: string; readonly aliases: readonly string[] };
  const rows = await selectAll(c, "exercises", { columns: "id,name,aliases", order: "id" }, (raw): Entry => {
    const r = raw as Record<string, unknown>; // a PostgREST row object, narrowed below
    if (typeof r.id !== "number" || typeof r.name !== "string" || !Array.isArray(r.aliases)) {
      throw new RowError("exercises row must have id, name and aliases");
    }
    return { id: r.id, name: r.name, aliases: r.aliases.filter((a) => typeof a === "string") };
  });
  const ids = new Map<string, number>();
  for (const e of rows) if (!ids.has(exerciseKey(e.name))) ids.set(exerciseKey(e.name), e.id);
  for (const e of rows) for (const a of e.aliases) if (!ids.has(exerciseKey(a))) ids.set(exerciseKey(a), e.id);
  return ids;
}

type Key = { readonly date: string; readonly session: number; readonly id: number };

function keyParams(k: Key): Filter[] {
  return [
    ["date", `eq.${k.date}`],
    ["session_no", `eq.${k.session}`],
    ["exercise_id", `eq.${k.id}`],
  ];
}

async function readRow(c: PostgrestClient, k: Key): Promise<LogRow | null> {
  return selectFirst(c, LOG, { columns: "started_at,ended_at", order: "date", filters: keyParams(k) }, (raw) => ({
    startedAt: text(raw, "started_at"),
    endedAt: text(raw, "ended_at"),
  }));
}

/** Sets `fields` to `at` where they are null (first write wins); creates the row if needed. */
async function setIfNull(c: PostgrestClient, k: Key, fields: readonly Field[], at: string): Promise<void> {
  const values = Object.fromEntries(fields.map((f) => [f, at]));
  await write(c, LOG, "POST", {
    params: [["on_conflict", "date,session_no,exercise_id"]],
    body: { date: k.date, session_no: k.session, exercise_id: k.id, ...values, updated_at: at },
    prefer: "resolution=ignore-duplicates",
  });
  for (const field of fields) {
    await write(c, LOG, "PATCH", {
      params: [...keyParams(k), [field, "is.null"]],
      body: { [field]: at, updated_at: at },
    });
  }
}

/** The same instant (the server returns "…+00:00", the tap wrote "…Z"). */
function sameInstant(stored: string | null, at: string): boolean {
  return stored !== null && Date.parse(stored) === Date.parse(at);
}

/** Clears every field that still holds `at` (what one tap wrote); deletes the row if empty. */
async function clearIfEqual(c: PostgrestClient, k: Key, at: string, now: string): Promise<void> {
  for (const field of ["ended_at", "started_at"] as const) {
    await write(c, LOG, "PATCH", {
      params: [...keyParams(k), [field, `eq.${at}`]],
      body: { [field]: null, updated_at: now },
    });
  }
  await write(c, LOG, "DELETE", {
    params: [...keyParams(k), ["started_at", "is.null"], ["ended_at", "is.null"]],
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

export async function recordTap(input: TapInput, now: Date, options: RecordOptions = {}): Promise<TapResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (devSwitchOn(env, nodeEnv)) return { ok: false, reason: "dev" };
  if (input.date !== localToday(now)) return { ok: false, reason: "invalid" };
  try {
    const c = makeClient();
    const named = [input.exercise, input.next].filter((n) => n !== null);
    const [inSession, ids] = await Promise.all([
      sessionNames(c, isoWeekStart(input.date), input.session),
      exerciseIds(c),
    ]);
    if (!named.every((n) => inSession.has(exerciseKey(n)) && ids.has(exerciseKey(n)))) {
      return { ok: false, reason: "invalid" };
    }
    const key = (n: string): Key => {
      const id = ids.get(exerciseKey(n));
      if (id === undefined) throw new RowError("exercise checked above has no id"); // unreachable
      return { date: input.date, session: input.session, id };
    };
    const x = key(input.exercise);
    const next = input.next === null ? null : key(input.next);
    const at = now.toISOString();
    switch (input.kind) {
      case "start": {
        await setIfNull(c, x, ["started_at"], at);
        const row = await readRow(c, x);
        return { ok: true, at: sameInstant(row?.startedAt ?? null, at) ? at : null };
      }
      case "end": {
        await setIfNull(c, x, ["started_at", "ended_at"], at);
        if (next !== null) await setIfNull(c, next, ["started_at"], at);
        const [own, following] = await Promise.all([readRow(c, x), next === null ? null : readRow(c, next)]);
        const wrote =
          sameInstant(own?.startedAt ?? null, at) ||
          sameInstant(own?.endedAt ?? null, at) ||
          sameInstant(following?.startedAt ?? null, at);
        return { ok: true, at: wrote ? at : null };
      }
      case "undo-end":
      case "undo-start": {
        if (input.at === null) return { ok: false, reason: "invalid" }; // parseTapInput requires it
        await clearIfEqual(c, x, input.at, at);
        if (input.kind === "undo-end" && next !== null) await clearIfEqual(c, next, input.at, at);
        return { ok: true, at: null };
      }
    }
  } catch (error) {
    if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
      console.error("exercise_log: tap not saved", error.message);
      return { ok: false, reason: "failed" };
    }
    throw error;
  }
}
