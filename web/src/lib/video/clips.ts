/**
 * Video clips of working sets (user, 2026-10-17, slices video-record / video-library): the
 * actions' input parsers, result types and the row type. Pure, no I/O. The video stays on the
 * phone (OPFS, lib/video/opfs.ts); public.video_clips holds only metadata (never frames,
 * landmarks, file names, paths, device info or a hash). Python never reads it.
 */
import type { IsoDate } from "../db/rows.ts";

/** numeric(6,1) with check 0 < duration_s <= 900 in public.video_clips. */
export const MAX_DURATION_S = 900;
/** Clips are kept 8 weeks from recorded_at, unless starred. */
export const KEEP_DAYS = 56;

const MAX_SESSION = 14;
const MAX_ROW = 10_000;
const MAX_SET = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A uuid as crypto.randomUUID() makes it and Postgres returns it: lower case, 8-4-4-4-12. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SaveClipInput = {
  readonly id: string;
  readonly date: IsoDate;
  readonly sessionNo: number;
  readonly row: number; // the sheet row
  readonly set: number; // 0 = a warm-up (refused), 1.. = a working set
  readonly durationS: number; // as sent; range-checked by the action after rounding to 0.1 s
};

export type SaveClipReason = "invalid" | "not_allowed" | "not_today" | "warmup" | "no_set" | "no_exercise" | "duration" | "failed";

export type SaveClipResult =
  | { readonly ok: true; readonly dev: boolean; readonly id: string }
  | { readonly ok: false; readonly reason: SaveClipReason };

/** `found` false: no row with that id (not saved yet), so the phone keeps its star unsynced. */
export type StarClipResult =
  | { readonly ok: true; readonly dev: boolean; readonly found: boolean }
  | { readonly ok: false; readonly reason: "invalid" | "failed" };

/** Idempotent: a clip already gone is ok. */
export type DeleteClipResult =
  | { readonly ok: true; readonly dev: boolean }
  | { readonly ok: false; readonly reason: "invalid" | "failed" };

/** public.video_clips, one row per clip. */
export type VideoClipRow = {
  readonly id: string;
  readonly date: IsoDate;
  readonly session: number;
  readonly row: number;
  readonly set: number; // ≥ 1, working sets only
  readonly exerciseId: number;
  readonly variantId: number | null; // null = ukendt
  readonly recordedAt: string; // the server's clock at the first insert (timestamptz)
  readonly durationS: number; // 0 < x ≤ 900
  readonly starred: boolean;
  readonly clipInS: number | null; // null until a later slice sets in/out points
  readonly clipOutS: number | null;
};

function whole(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function validDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(value); // rejects 2026-02-30
}

export function isClipId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The save action's input from an untrusted client: exact shape or null. Set 0 and the duration's range are refusals. */
export function parseSaveClipInput(raw: unknown): SaveClipInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const sessionNo = whole(r.sessionNo, 1, MAX_SESSION);
  const row = whole(r.row, 1, MAX_ROW);
  const set = whole(r.set, 0, MAX_SET);
  if (!isClipId(r.id) || !validDate(r.date) || sessionNo === null || row === null || set === null) return null;
  if (typeof r.durationS !== "number" || !Number.isFinite(r.durationS)) return null;
  return { id: r.id, date: r.date, sessionNo, row, set, durationS: r.durationS };
}

/** The duration as numeric(6,1) stores it, or null outside 0 < x ≤ MAX_DURATION_S after rounding. */
export function storedDuration(durationS: number): number | null {
  const d = Math.round(durationS * 10) / 10;
  return d > 0 && d <= MAX_DURATION_S ? d : null;
}

export function parseStarClipInput(raw: unknown): { readonly id: string; readonly starred: boolean } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  if (!isClipId(r.id) || typeof r.starred !== "boolean") return null;
  return { id: r.id, starred: r.starred };
}

export function parseDeleteClipInput(raw: unknown): { readonly id: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  return isClipId(r.id) ? { id: r.id } : null;
}

/**
 * Recording is offered only on the production host and under `next dev` (security, 2026-10-17:
 * Vercel's toolbar script runs on preview URLs). VERCEL_ENV is "production" | "preview" |
 * "development" on Vercel and unset elsewhere; a local `next start` is neither, so no camera.
 */
export function recordingAllowed(env: Readonly<Record<string, string | undefined>>, nodeEnv: string | undefined): boolean {
  if (env.VERCEL_ENV === "preview") return false;
  return nodeEnv === "development" || env.VERCEL_ENV === "production";
}
