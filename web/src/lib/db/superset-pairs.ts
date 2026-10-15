import "server-only";

import { isoWeekStart } from "../dates.ts";
import { effectivePairs, pairLocked, type SupersetInput, type SupersetResult, sessionRuns } from "../supersets.ts";
import { localToday } from "../training-view.ts";
import { devSwitchOn } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import { createClient, type PostgrestClient, PostgrestError, selectAll, write } from "./postgrest.ts";
import { parseSetLogRow, RowError, SET_LOG_SELECT, SUPERSET_PAIRS_SELECT } from "./rows.ts";
import { exerciseIds, sessionPairRows, sessionSets } from "./set-log.ts";

/**
 * The app's third write path (user, 2026-10-15, slice supersets): a superset switched on or off
 * on Træning, into public.superset_pairs. Server-side only with the service key, behind Vercel
 * Authentication, via setSupersetPair in app/actions.ts. Rules in lib/supersets.ts.
 *  - The client sends { date, sessionNo, rowA, rowB, paired }; exercise and variant ids come from
 *    the sheet's rows (strength_sets of that ISO week's session) and public.exercises, never from
 *    the client.
 *  - Refused (no write): not today (Copenhagen) or no such session; rowA/rowB not the first rows of
 *    two consecutive runs; a set of either run logged (except A's warm-up); pairing a run that is
 *    already in another pair in force.
 *  - One write: an upsert of the desired state on the primary key (resolution=merge-duplicates),
 *    updated_at = this server's clock. A retry, or the opposite tap, is the same upsert; nothing is
 *    ever deleted (paired false records the "no").
 * Dev switches (DEV_TODAY, DEV_FIXTURE) write nothing and answer with the pairs as they would be.
 */

const TABLE = SUPERSET_PAIRS_SELECT.table;

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

/** Injectable for tests; production reads process.env and uses globalThis.fetch. */
export type SupersetOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeEnv?: string;
  readonly client?: () => PostgrestClient;
};

export async function recordSupersetPair(input: SupersetInput, now: Date, options: SupersetOptions = {}): Promise<SupersetResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  const dev = devSwitchOn(env, nodeEnv);
  if (!dev && input.date !== localToday(now)) return { ok: false, reason: "not_today" };
  try {
    const c = makeClient();
    const [sets, ids] = await Promise.all([sessionSets(c, isoWeekStart(input.date), input.sessionNo), exerciseIds(c)]);
    if (sets.length === 0) return { ok: false, reason: "no_session" };
    const runs = sessionRuns(sets, ids);
    const i = runs.findIndex((r) => r.row === input.rowA);
    const a = runs.at(i);
    const b = i === -1 ? undefined : runs.at(i + 1);
    if (a === undefined || b === undefined || i === -1 || b.row !== input.rowB || a.exerciseId === null || b.exerciseId === null) {
      return { ok: false, reason: "not_consecutive" };
    }
    const [pairRows, log] = await Promise.all([
      sessionPairRows(c, input.date, input.sessionNo, runs),
      selectAll(
        c,
        SET_LOG_SELECT.table,
        { ...SET_LOG_SELECT, filters: [["date", `eq.${input.date}`], ["session_no", `eq.${input.sessionNo}`]] },
        parseSetLogRow,
      ),
    ]);
    if (pairLocked(a, b, log)) return { ok: false, reason: "started" };
    const before = effectivePairs(runs, pairRows.today, pairRows.history);
    const own = before.some((p) => p.rowA === a.row && p.rowB === b.row);
    if (input.paired && !own && before.some((p) => [p.rowA, p.rowB].some((r) => r === a.row || r === b.row))) {
      return { ok: false, reason: "overlap" };
    }
    const at = now.toISOString();
    const row = {
      date: input.date,
      session_no: input.sessionNo,
      row_a: a.row,
      row_b: b.row,
      exercise_a: a.exerciseId,
      variant_a: a.variantId,
      exercise_b: b.exerciseId,
      variant_b: b.variantId,
      paired: input.paired,
    };
    const today = [
      ...pairRows.today.filter((r) => r.rowA !== a.row),
      { date: input.date, session: input.sessionNo, rowA: a.row, rowB: b.row, exerciseA: a.exerciseId, variantA: a.variantId, exerciseB: b.exerciseId, variantB: b.variantId, paired: input.paired, updatedAt: at },
    ];
    const pairs = effectivePairs(runs, today, pairRows.history);
    if (dev) return { ok: true, pairs }; // nothing is written under a dev switch
    await write(c, TABLE, "POST", {
      params: [["on_conflict", "date,session_no,row_a"]],
      body: { ...row, updated_at: at },
      prefer: "resolution=merge-duplicates",
    });
    return { ok: true, pairs };
  } catch (error) {
    if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
      console.error("superset_pairs: not saved", error.message);
      return { ok: false, reason: "failed" };
    }
    throw error;
  }
}
