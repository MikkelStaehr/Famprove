import "server-only";

import { addDays, isoWeekStart } from "../dates.ts";
import { exerciseIdOf } from "../supersets.ts";
import { localToday } from "../training-view.ts";
import {
  type DeleteClipResult,
  clipDateAge,
  KEEP_DAYS,
  recordingAllowed,
  type SaveClipInput,
  type SaveClipResult,
  type StarClipResult,
  storedDuration,
  type VideoClipRow,
} from "../video/clips.ts";
import { devFixture, devSwitchOn } from "./dev-fixture.ts";
import { EnvError, readSupabaseEnv } from "./env.ts";
import { createClient, patchCount, type PostgrestClient, PostgrestError, selectAll, write } from "./postgrest.ts";
import { parseVideoClipRow, RowError, VIDEO_CLIPS_SELECT } from "./rows.ts";
import { exerciseIds, sessionSets } from "./set-log.ts";
import { type ClipNames, type RunSets, runSetNumbers, type SessionSetRow } from "../video/library-view.ts";
import { FIXTURE_FAILING_RANGE_ID, type SetClipRangeInput, type SetClipRangeResult, validateClipRange } from "../video/clip-range.ts";
import { expectedReps, liftFamily, type SetClipAutoInput, type SetClipAutoResult, validateClipAuto } from "../video/auto-clip.ts";
import { PICKUP_DAYS } from "../video/auto-lines.ts";
import { type TrimClipInput, type TrimClipResult, validateTrim } from "../video/trim.ts";
import type { ClipLiftMeta } from "../video/auto-lines.ts";

/**
 * The app's fifth write path (user, 2026-10-17, slice video-record): a working set's clip recorded
 * in Fokus, into public.video_clips via saveClip / starClip / deleteClip in app/actions.ts.
 * Server-side only with the service key, behind Vercel Authentication. Only metadata: the video
 * stays on the phone (lib/video/opfs.ts); never frames, landmarks, file names, paths, device
 * info or a hash.
 *  - save: the client sends { id (its uuid), date, sessionNo, row, set, durationS }; exercise_id and
 *    variant_id come from the sheet's row (strength_sets of that ISO week's session) and
 *    public.exercises, never from the client. Refused (no write): recording not allowed on this
 *    host (a preview URL); a date in the future or older than KEEP_DAYS (Copenhagen; an insert that
 *    failed is retried on a later day, so an earlier date in the keep is fine); a warm-up (set 0); the set not in the session;
 *    its exercise not in the catalogue; the duration outside 0 < x ≤ 900 s after rounding to 0.1.
 *    One request: insert on conflict (id) do nothing (resolution=ignore-duplicates), so a retry
 *    after a lost reply is the same row and the first insert's recorded_at stands.
 *  - star: one PATCH of starred by id; `found` says whether the row exists yet.
 *  - range (slice clip-handles): the user's in/out, one PATCH of clip_in_s/clip_out_s by id after one
 *    read of the row's duration_s; both numbers or both null, rounded to 0.1, 0 ≤ in < out, out − in ≥ 1,
 *    out ≤ duration_s (lib/video/clip-range.ts, shared with the editor). Refused on a preview host.
 *  - auto (slice clip-auto): the phone's automatic clip, one PATCH of auto_in_s/auto_out_s/auto_status/
 *    auto_run_ms by id after one read of duration_s (lib/video/auto-clip.ts validateClipAuto). Never
 *    landmarks or frames: the input type has only those four values. Refused on a preview host.
 *  - delete: one DELETE by id (deleting a clip on the phone deletes its row); idempotent.
 * Dev switches (DEV_TODAY, DEV_FIXTURE) write nothing and answer as if written.
 * Python never reads the table: TSS is unchanged.
 */

const TABLE = VIDEO_CLIPS_SELECT.table;

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

/** Injectable for tests; production reads process.env and uses globalThis.fetch. */
export type VideoClipOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeEnv?: string;
  readonly client?: () => PostgrestClient;
};

function failed(error: unknown, what: string): { readonly ok: false; readonly reason: "failed" } {
  if (error instanceof PostgrestError || error instanceof EnvError || error instanceof RowError) {
    console.error(`video_clips: ${what}`, error.message);
    return { ok: false, reason: "failed" };
  }
  throw error;
}

export async function recordClip(input: SaveClipInput, now: Date, options: VideoClipOptions = {}): Promise<SaveClipResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (!recordingAllowed(env, nodeEnv)) return { ok: false, reason: "not_allowed" };
  if (input.set < 1) return { ok: false, reason: "warmup" };
  const durationS = storedDuration(input.durationS);
  if (durationS === null) return { ok: false, reason: "duration" };
  if (devSwitchOn(env, nodeEnv)) return { ok: true, dev: true, id: input.id }; // nothing is read or written
  const age = clipDateAge(input.date, localToday(now));
  if (age !== null) return { ok: false, reason: age };
  try {
    const c = makeClient();
    const [sets, ids] = await Promise.all([sessionSets(c, isoWeekStart(input.date), input.sessionNo), exerciseIds(c)]);
    const sheetSet = sets.find((s) => s.ref.row === input.row && s.ref.set === input.set);
    if (sheetSet === undefined) return { ok: false, reason: "no_set" };
    const exerciseId = exerciseIdOf(ids, sheetSet.name);
    if (exerciseId === null) return { ok: false, reason: "no_exercise" };
    await write(c, TABLE, "POST", {
      params: [["on_conflict", "id"]],
      body: {
        id: input.id,
        date: input.date,
        session_no: input.sessionNo,
        row_no: input.row,
        set_no: input.set,
        exercise_id: exerciseId,
        variant_id: sheetSet.variantId,
        duration_s: durationS,
      }, // recorded_at: the column's default, the server's clock at the first insert
      prefer: "resolution=ignore-duplicates",
    });
    return { ok: true, dev: false, id: input.id };
  } catch (error) {
    return failed(error, "clip not saved");
  }
}

export async function recordStar(
  input: { readonly id: string; readonly starred: boolean },
  options: VideoClipOptions = {},
): Promise<StarClipResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (devSwitchOn(env, nodeEnv)) return { ok: true, dev: true, found: true };
  try {
    const n = await patchCount(makeClient(), TABLE, { params: [["id", `eq.${input.id}`]], body: { starred: input.starred }, columns: "id" });
    return { ok: true, dev: false, found: n > 0 };
  } catch (error) {
    return failed(error, "star not saved");
  }
}

/**
 * The user's in/out (slice clip-handles): one PATCH of clip_in_s/clip_out_s on the clip's id, after one
 * read of its duration_s. Idempotent: the same values twice give the same row. Refused on a preview
 * host (as recordClip), for a bad range, or `not_found` without the row. Dev switches read and write
 * nothing and answer as if saved, except the clips fixture's failing clip (the failed line's shot).
 */
export async function recordClipRange(input: SetClipRangeInput, options: VideoClipOptions = {}): Promise<SetClipRangeResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (!recordingAllowed(env, nodeEnv)) return { ok: false, reason: "not_allowed" };
  const shaped = validateClipRange(input.inS, input.outS, null);
  if (shaped === null) return { ok: false, reason: "range" };
  if (devSwitchOn(env, nodeEnv)) {
    if (devFixture(env, nodeEnv) === "clips" && input.id === FIXTURE_FAILING_RANGE_ID) return { ok: false, reason: "failed" };
    return { ok: true, dev: true, ...shaped };
  }
  try {
    const c = makeClient();
    const found = await selectAll(c, TABLE, { columns: "id,duration_s", order: "id", filters: [["id", `eq.${input.id}`]] }, (raw) => {
      if (typeof raw !== "object" || raw === null) throw new RowError(`${TABLE}: expected an object`);
      const d = (raw as Record<string, unknown>).duration_s; // checked below
      if (typeof d !== "number") throw new RowError(`${TABLE}.duration_s must be a number`);
      return d;
    });
    const durationS = found[0];
    if (durationS === undefined) return { ok: false, reason: "not_found" };
    const range = validateClipRange(input.inS, input.outS, durationS);
    if (range === null) return { ok: false, reason: "range" };
    const n = await patchCount(c, TABLE, { params: [["id", `eq.${input.id}`]], body: { clip_in_s: range.inS, clip_out_s: range.outS }, columns: "id" });
    if (n === 0) return { ok: false, reason: "not_found" }; // deleted between the read and the write
    return { ok: true, dev: false, ...range };
  } catch (error) {
    return failed(error, "clip range not saved");
  }
}

/**
 * A committed manual cut (slice clip-trim): one PATCH of duration_s (the cut file's own length) with
 * clip_in_s/clip_out_s and auto_* null (the file is the clip, so no stored range applies), after one
 * read of the row's duration_s, filtered duration_s ≥ new so it never raises (0 rows = `duration`).
 * Refused unless 0 < new < current (validateTrim); the same new
 * duration again is ok (idempotent: a retry after a lost reply). Refused on a preview host.
 * Dev switches read and write nothing and answer as if saved.
 */
export async function recordClipTrim(input: TrimClipInput, options: VideoClipOptions = {}): Promise<TrimClipResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (!recordingAllowed(env, nodeEnv)) return { ok: false, reason: "not_allowed" };
  const shaped = validateTrim(input.durationS, null);
  if (shaped === null) return { ok: false, reason: "duration" };
  if (devSwitchOn(env, nodeEnv)) return { ok: true, dev: true, durationS: shaped }; // nothing is read or written
  try {
    const c = makeClient();
    const current = await clipDuration(c, input.id);
    if (current === undefined) return { ok: false, reason: "not_found" };
    const durationS = validateTrim(input.durationS, current);
    if (durationS === null) return { ok: false, reason: "duration" };
    const n = await patchCount(c, TABLE, {
      params: [
        ["id", `eq.${input.id}`],
        ["duration_s", `gte.${durationS}`], // "never raise" in the write itself
      ],
      body: { duration_s: durationS, clip_in_s: null, clip_out_s: null, auto_in_s: null, auto_out_s: null, auto_status: null, auto_run_ms: null },
      columns: "id",
    });
    if (n === 0) return { ok: false, reason: "duration" }; // shorter than the new one by now (or deleted): never raised
    return { ok: true, dev: false, durationS };
  } catch (error) {
    return failed(error, "clip trim not saved");
  }
}

/** duration_s of one clip, or undefined when there is no such row. Errors propagate. */
async function clipDuration(c: PostgrestClient, id: string): Promise<number | undefined> {
  const found = await selectAll(c, TABLE, { columns: "id,duration_s", order: "id", filters: [["id", `eq.${id}`]] }, (raw) => {
    if (typeof raw !== "object" || raw === null) throw new RowError(`${TABLE}: expected an object`);
    const d = (raw as Record<string, unknown>).duration_s; // checked below
    if (typeof d !== "number") throw new RowError(`${TABLE}.duration_s must be a number`);
    return d;
  });
  return found[0];
}

/**
 * The automatic clip (slice clip-auto): one PATCH of only auto_in_s, auto_out_s, auto_status and
 * auto_run_ms on the clip's id, after one read of its duration_s. Idempotent: the same values twice
 * give the same row. Refused on a preview host (as recordClip), for a bad status/range/run time, or
 * `not_found` without the row. Dev switches read and write nothing and answer as if saved.
 */
export async function recordClipAuto(input: SetClipAutoInput, options: VideoClipOptions = {}): Promise<SetClipAutoResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (!recordingAllowed(env, nodeEnv)) return { ok: false, reason: "not_allowed" };
  const shaped = validateClipAuto(input, null);
  if (shaped === null) return { ok: false, reason: "range" };
  if (devSwitchOn(env, nodeEnv)) return { ok: true, dev: true, ...shaped }; // nothing is read or written
  try {
    const c = makeClient();
    const durationS = await clipDuration(c, input.id);
    if (durationS === undefined) return { ok: false, reason: "not_found" };
    const auto = validateClipAuto(input, durationS);
    if (auto === null) return { ok: false, reason: "range" };
    const n = await patchCount(c, TABLE, {
      params: [["id", `eq.${input.id}`]],
      body: { auto_in_s: auto.inS, auto_out_s: auto.outS, auto_status: auto.status, auto_run_ms: auto.runMs },
      columns: "id",
    });
    if (n === 0) return { ok: false, reason: "not_found" }; // deleted between the read and the write
    return { ok: true, dev: false, ...auto };
  } catch (error) {
    return failed(error, "auto clip not saved");
  }
}

export async function removeClip(input: { readonly id: string }, options: VideoClipOptions = {}): Promise<DeleteClipResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (devSwitchOn(env, nodeEnv)) return { ok: true, dev: true };
  try {
    await write(makeClient(), TABLE, "DELETE", { params: [["id", `eq.${input.id}`]] });
    return { ok: true, dev: false };
  } catch (error) {
    return failed(error, "clip not deleted");
  }
}

/**
 * The clips the phone's library and cleanup compare against: every row dated within the last
 * KEEP_DAYS days (today included) plus every starred row, newest first. Under DEV_FIXTURE nothing
 * is read (a fixture has no clips); DEV_TODAY reads as usual (read-only). Errors propagate.
 */
export async function readVideoClips(now: Date, options: VideoClipOptions = {}): Promise<VideoClipRow[]> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  if (devFixture(env, nodeEnv) !== null) return [];
  const since = addDays(localToday(now), -KEEP_DAYS);
  return selectAll(makeClient(), TABLE, { ...VIDEO_CLIPS_SELECT, filters: [["or", `(date.gte.${since},starred.is.true)`]] }, parseVideoClipRow);
}

/** The Optagelser card's names: public.exercises.name and exercise_variants.display_name by id. Errors propagate. */
export async function readClipNames(options: VideoClipOptions = {}): Promise<ClipNames> {
  const { client: makeClient = client } = options;
  const c = makeClient();
  const named = (table: string, col: string) =>
    selectAll(c, table, { columns: `id,${col}`, order: "id" }, (raw) => {
      if (typeof raw !== "object" || raw === null) throw new RowError(`${table}: expected an object`);
      const r = raw as Record<string, unknown>; // checked field by field below
      if (typeof r.id !== "number" || typeof r[col] !== "string") throw new RowError(`${table} row must have id and ${col}`);
      return [r.id, r[col] as string] as const;
    });
  const [ex, va] = await Promise.all([named("exercises", "name"), named("exercise_variants", "display_name")]);
  return { exercises: Object.fromEntries(ex), variants: Object.fromEntries(va) };
}

/**
 * The run numbers of the clips' sets (slice clip-set-no): one read of strength_sets for every ISO
 * week holding a clip row, plus today's week (a clip not yet synced). A week no longer in the sheet
 * has no rows, so its clips keep set_no. Errors propagate.
 */
export async function readClipRunSets(rows: readonly VideoClipRow[], now: Date, options: VideoClipOptions = {}): Promise<RunSets> {
  const { client: makeClient = client } = options;
  const weeks = [...new Set([...rows.map((r) => isoWeekStart(r.date)), isoWeekStart(localToday(now))])].toSorted();
  const sets = await selectAll(
    makeClient(),
    "strength_sets",
    { columns: "week_start,session,block,sheet_row,set_no,name,variant_id", order: "week_start,session,block,sheet_row,set_no", filters: [["week_start", `in.(${weeks.join(",")})`], ["session", "not.is.null"]] },
    (raw): SessionSetRow => {
      if (typeof raw !== "object" || raw === null) throw new RowError("strength_sets: expected an object");
      const r = raw as Record<string, unknown>; // checked field by field below
      if (typeof r.week_start !== "string" || typeof r.session !== "number" || typeof r.block !== "string" || typeof r.sheet_row !== "number" || typeof r.set_no !== "number" || typeof r.name !== "string") {
        throw new RowError("strength_sets row must have week_start, session, block, sheet_row, set_no and name");
      }
      if (r.variant_id !== null && r.variant_id !== undefined && typeof r.variant_id !== "number") throw new RowError("strength_sets.variant_id must be a number or null");
      return { weekStart: r.week_start, session: r.session, block: r.block, row: r.sheet_row, set: r.set_no, name: r.name, variantId: typeof r.variant_id === "number" ? r.variant_id : null };
    },
  );
  return runSetNumbers(sets);
}

/**
 * clip-auto's pickup: each recent clip's lift family (the sheet TYPE) and expected reps (the set
 * log's reps_done, else the sheet's reps text), by clip id. One read of strength_sets for the clips'
 * weeks and one of exercise_set_log for their dates; a clip whose set isn't found has no entry
 * (the pickup skips it, never guesses). Errors propagate.
 */
export async function readClipLifts(rows: readonly VideoClipRow[], now: Date, options: VideoClipOptions = {}): Promise<Record<string, ClipLiftMeta>> {
  const { client: makeClient = client } = options;
  const since = addDays(localToday(now), -PICKUP_DAYS);
  const recent = rows.filter((r) => r.date >= since);
  if (recent.length === 0) return {};
  const c = makeClient();
  const weeks = [...new Set(recent.map((r) => isoWeekStart(r.date)))].toSorted();
  const dates = [...new Set(recent.map((r) => r.date))].toSorted();
  const key = (week: string, session: number, row: number, set: number) => `${week}|${session}|${row}|${set}`;
  const [sets, logs] = await Promise.all([
    selectAll(
      c,
      "strength_sets",
      { columns: "week_start,session,sheet_row,set_no,type,reps_text", order: "week_start,session,sheet_row,set_no", filters: [["week_start", `in.(${weeks.join(",")})`], ["session", "not.is.null"]] },
      (raw) => {
        if (typeof raw !== "object" || raw === null) throw new RowError("strength_sets: expected an object");
        const r = raw as Record<string, unknown>; // checked field by field below
        if (typeof r.week_start !== "string" || typeof r.session !== "number" || typeof r.sheet_row !== "number" || typeof r.set_no !== "number" || typeof r.type !== "string") {
          throw new RowError("strength_sets row must have week_start, session, sheet_row, set_no and type");
        }
        return [key(r.week_start, r.session, r.sheet_row, r.set_no), { type: r.type, repsText: typeof r.reps_text === "string" ? r.reps_text : null }] as const;
      },
    ),
    selectAll(
      c,
      "exercise_set_log",
      { columns: "date,session_no,row_no,set_no,reps_done", order: "date,session_no,row_no,set_no", filters: [["date", `in.(${dates.join(",")})`]] },
      (raw) => {
        if (typeof raw !== "object" || raw === null) throw new RowError("exercise_set_log: expected an object");
        const r = raw as Record<string, unknown>; // checked field by field below
        if (typeof r.date !== "string" || typeof r.session_no !== "number" || typeof r.row_no !== "number" || typeof r.set_no !== "number") {
          throw new RowError("exercise_set_log row must have date, session_no, row_no and set_no");
        }
        return [`${r.date}|${r.session_no}|${r.row_no}|${r.set_no}`, typeof r.reps_done === "number" ? r.reps_done : null] as const;
      },
    ),
  ]);
  const sheet = new Map(sets);
  const done = new Map(logs);
  const out: Record<string, ClipLiftMeta> = {};
  for (const r of recent) {
    const s = sheet.get(key(isoWeekStart(r.date), r.session, r.row, r.set));
    if (s === undefined) continue;
    out[r.id] = { family: liftFamily(s.type), expected: expectedReps(done.get(`${r.date}|${r.session}|${r.row}|${r.set}`), s.repsText) };
  }
  return out;
}
