import "server-only";

import { isoWeekStart } from "../dates.ts";
import type { SetPartsInput, SetPartsResult } from "../set-parts.ts";
import { localToday } from "../training-view.ts";
import { devSwitchOn } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import { createClient, type PostgrestClient, PostgrestError, selectAll, write } from "./postgrest.ts";
import { parseSetLogRow, parseVariantPartRow, RowError, SET_LOG_SELECT, SET_PARTS_SELECT, VARIANT_PARTS_SELECT } from "./rows.ts";
import { sessionSets } from "./set-log.ts";

/**
 * The parts of a combined variant's done set (user, 2026-10-17, slice combo-parts, spec
 * design/specs/combo-parts.md), into public.exercise_set_parts via setSetParts in app/actions.ts.
 * Server-side only with the service key, behind Vercel Authentication.
 *  - The client sends { date, sessionNo, row, set, parts: [{ partNo, kg, reps, perSide }] }
 *    (lib/set-parts.ts parses it strictly); the variant comes from the sheet's row (strength_sets of
 *    that ISO week's session), never from the client.
 *  - Refused (no write): not today (Copenhagen); the set not in the session; the set not done in
 *    exercise_set_log; its variant without parts; a partNo not one of the variant's parts.
 *  - One request: a bulk upsert of every part on the primary key (resolution=merge-duplicates),
 *    updated_at = this server's clock. A retry is the same write; nothing is deleted.
 * Dev switches (DEV_TODAY, DEV_FIXTURE) read and write nothing (a fixture's variant is not in the
 * database) and answer with what would be stored. Python never reads the table: TSS is unchanged.
 */

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

/** Injectable for tests; production reads process.env and uses globalThis.fetch. */
export type SetPartsOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeEnv?: string;
  readonly client?: () => PostgrestClient;
};

export async function recordSetParts(input: SetPartsInput, now: Date, options: SetPartsOptions = {}): Promise<SetPartsResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  const stored = { row: input.row, set: input.set, parts: input.parts.toSorted((a, b) => a.partNo - b.partNo) };
  if (devSwitchOn(env, nodeEnv)) return { ok: true, dev: true, stored }; // nothing is read or written
  if (input.date !== localToday(now)) return { ok: false, reason: "not_today" };
  try {
    const c = makeClient();
    const sets = await sessionSets(c, isoWeekStart(input.date), input.sessionNo);
    const sheetSet = sets.find((s) => s.ref.row === input.row && s.ref.set === input.set);
    if (sheetSet === undefined) return { ok: false, reason: "no_set" };
    const variantId = sheetSet.variantId;
    if (variantId === null) return { ok: false, reason: "no_parts" };
    const [log, parts] = await Promise.all([
      selectAll(
        c,
        SET_LOG_SELECT.table,
        {
          ...SET_LOG_SELECT,
          filters: [["date", `eq.${input.date}`], ["session_no", `eq.${input.sessionNo}`], ["row_no", `eq.${input.row}`], ["set_no", `eq.${input.set}`]],
        },
        parseSetLogRow,
      ),
      selectAll(c, VARIANT_PARTS_SELECT.table, { ...VARIANT_PARTS_SELECT, filters: [["variant_id", `eq.${variantId}`]] }, parseVariantPartRow),
    ]);
    if (!log.some((r) => r.endedAt !== null && !r.skipped)) return { ok: false, reason: "not_done" };
    if (parts.length === 0) return { ok: false, reason: "no_parts" };
    if (input.parts.some((p) => !parts.some((v) => v.partNo === p.partNo))) return { ok: false, reason: "unknown_part" };
    const at = now.toISOString();
    await write(c, SET_PARTS_SELECT.table, "POST", {
      params: [["on_conflict", "date,session_no,row_no,set_no,part_no"]],
      body: stored.parts.map((p) => ({
        date: input.date,
        session_no: input.sessionNo,
        row_no: input.row,
        set_no: input.set,
        part_no: p.partNo,
        variant_id: variantId,
        kg: p.kg,
        reps: p.reps,
        per_side: p.perSide,
        updated_at: at,
      })),
      prefer: "resolution=merge-duplicates",
    });
    return { ok: true, dev: false, stored };
  } catch (error) {
    if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
      console.error("exercise_set_parts: not saved", error.message);
      return { ok: false, reason: "failed" };
    }
    throw error;
  }
}
