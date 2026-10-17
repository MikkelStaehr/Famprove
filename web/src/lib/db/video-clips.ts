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
import type { ClipNames } from "../video/library-view.ts";

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
