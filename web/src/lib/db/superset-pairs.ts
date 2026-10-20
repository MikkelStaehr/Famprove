import "server-only";

import { isoWeekStart } from "../dates.ts";
import { orderedEffectivePairs, pairLocked, pickRunRows, runsInOrder, type SupersetInput, type SupersetResult, sessionRuns } from "../supersets.ts";
import { localToday } from "../training-view.ts";
import { devSwitchOn } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import { createClient, type PostgrestClient, PostgrestError, selectAll, write } from "./postgrest.ts";
import { parseSetLogRow, RowError, SESSION_ORDER_SELECT, SET_LOG_SELECT, SUPERSET_PAIRS_SELECT } from "./rows.ts";
import { exerciseIds, sessionPairRows, sessionRunRows, sessionSets } from "./set-log.ts";

/**
 * The app's third write path (user, 2026-10-15, slice supersets): a superset switched on or off
 * on Træning, into public.superset_pairs. Server-side only with the service key, behind Vercel
 * Authentication, via setSupersetPair in app/actions.ts. Rules in lib/supersets.ts.
 *  - The client sends { date, sessionNo, rowA, rowB, paired }; exercise and variant ids come from
 *    the sheet's rows (strength_sets of that ISO week's session) and public.exercises, never from
 *    the client.
 *  - Refused (no write): not today (Copenhagen) or no such session; rowA/rowB not the first rows of
 *    two runs of the session, or B = A; a set of either run logged (except A's warm-up); pairing a
 *    run that is already in another pair in force; B not right after A once the new order applies.
 *  - Since 2026-10-20 (user, slice superset-any) B may be any run that hasn't started. Two writes,
 *    in this order (CLAUDE.md "Multi-request writes"): 1. public.session_order upserted with B's run
 *    moved right after A's (pickRunRows on the stored order; skipped when it is already there; a
 *    jump's undo mark is left as it is); 2. the pair, last: an upsert of the desired state on the
 *    primary key (resolution=merge-duplicates), updated_at = this server's clock. A retry reads the
 *    stored state again, so it sends only what didn't land. Unpairing writes paired false only and
 *    never moves B back; nothing is ever deleted.
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
    const a = runs.find((r) => r.row === input.rowA);
    const b = runs.find((r) => r.row === input.rowB);
    if (a === undefined || b === undefined || a.row === b.row || a.exerciseId === null || b.exerciseId === null) {
      return { ok: false, reason: "not_consecutive" };
    }
    const [pairRows, log, stored] = await Promise.all([
      sessionPairRows(c, input.date, input.sessionNo, runs),
      selectAll(
        c,
        SET_LOG_SELECT.table,
        { ...SET_LOG_SELECT, filters: [["date", `eq.${input.date}`], ["session_no", `eq.${input.sessionNo}`]] },
        parseSetLogRow,
      ),
      sessionRunRows(c, input.date, input.sessionNo),
    ]);
    if (pairLocked(a, b, log)) return { ok: false, reason: "started" };
    // The pairs and the order from the stored state, so a retry computes the same writes.
    const before = orderedEffectivePairs(runs, pairRows.today, pairRows.history, stored.runRows);
    const own = before.some((p) => p.rowA === a.row && p.rowB === b.row);
    if (input.paired && !own && before.some((p) => [p.rowA, p.rowB].some((r) => r === a.row || r === b.row))) {
      return { ok: false, reason: "overlap" };
    }
    // A pick moves B right after A (null: it is already there, no order write); unpairing never moves B back.
    const moved = input.paired ? pickRunRows(runs, stored.runRows, a.row, b.row) : null;
    const runRows = moved ?? stored.runRows;
    const ordered = runsInOrder(runs, runRows);
    const i = ordered.findIndex((r) => r.row === a.row);
    if (ordered.at(i + 1)?.row !== b.row) return { ok: false, reason: "not_consecutive" };
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
    const pairs = orderedEffectivePairs(runs, today, pairRows.history, runRows);
    const result = { ok: true as const, pairs, ...(runRows === null ? {} : { runRows }) };
    if (dev) return result; // nothing is written under a dev switch
    // 1. The order (multi-request writes: the pair, the tap's mark, is written last). Only run_rows
    //    and updated_at: a jump's undo mark (previous_rows, jumped_at, moved_start) stays as it is.
    if (moved !== null) {
      await write(c, SESSION_ORDER_SELECT.table, "POST", {
        params: [["on_conflict", "date,session_no"]],
        body: { date: input.date, session_no: input.sessionNo, run_rows: moved, updated_at: at },
        prefer: "resolution=merge-duplicates",
      });
    }
    // 2. The pair, last.
    await write(c, TABLE, "POST", {
      params: [["on_conflict", "date,session_no,row_a"]],
      body: { ...row, updated_at: at },
      prefer: "resolution=merge-duplicates",
    });
    return result;
  } catch (error) {
    if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
      console.error("superset_pairs: not saved", error.message);
      return { ok: false, reason: "failed" };
    }
    throw error;
  }
}
