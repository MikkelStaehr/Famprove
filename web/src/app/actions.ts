"use server";

import { recordFtpChoice, undoFtpChoice } from "@/lib/db/ftp-ack";
import { recordSetTap, type SetTapResult } from "@/lib/db/set-log";
import { recordSetParts } from "@/lib/db/set-parts";
import { recordSupersetPair } from "@/lib/db/superset-pairs";
import { recordClip, recordClipAuto, recordClipRange, recordClipTrim, recordStar, removeClip } from "@/lib/db/video-clips";
import { parseSetClipAutoInput, type SetClipAutoResult } from "@/lib/video/auto-clip";
import { parseSetClipRangeInput, type SetClipRangeResult } from "@/lib/video/clip-range";
import { parseTrimClipInput, type TrimClipResult } from "@/lib/video/trim";
import { parseSetPartsInput, type SetPartsResult } from "@/lib/set-parts";
import { parseSupersetInput, type SupersetResult } from "@/lib/supersets";
import type { FtpChoiceResult, FtpUndoResult } from "@/lib/ftp-line";
import { parseSetTapInput } from "@/lib/set-taps";
import {
  type DeleteClipResult,
  parseDeleteClipInput,
  parseSaveClipInput,
  parseStarClipInput,
  type SaveClipResult,
  type StarClipResult,
} from "@/lib/video/clips";

/**
 * A set timing tap from the Træning screens (public.exercise_set_log), one of the app's two writes.
 * A Server Action is a public POST endpoint: the deployment is behind Vercel Authentication (All
 * Deployments), Next checks Origin against Host, and every input is checked again here (shape)
 * and in recordSetTap (today's date, the set in that session of the sheet). The client never
 * sends a time, a name or kg.
 */
export async function logExerciseTap(raw: unknown): Promise<SetTapResult> {
  const input = parseSetTapInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordSetTap(input, new Date());
}

/**
 * The user's answer to the FTP notice on /load (public.ftp_ack, slice ftp-confirm), the app's
 * second write: one insert per tap. The client sends only the choice; the W values and the time
 * are read and set on the server (lib/db/ftp-ack.ts), which also refuses it without a notice.
 */
export async function chooseFtpAnswer(raw: unknown): Promise<FtpChoiceResult> {
  return recordFtpChoice(raw);
}

/** Fortryd: deletes that answer, only while it is still the newest one. */
export async function undoFtpAnswer(raw: unknown): Promise<FtpUndoResult> {
  return undoFtpChoice(raw);
}

/**
 * A superset switched on or off on Træning (public.superset_pairs, slice supersets), the app's
 * third write: one upsert of the desired state. The client sends only the date, session, the two
 * runs' first rows and on/off; exercise ids, refusals and the time are the server's
 * (lib/db/superset-pairs.ts).
 */
export async function setSupersetPair(raw: unknown): Promise<SupersetResult> {
  const input = parseSupersetInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordSupersetPair(input, new Date());
}

/**
 * The parts of a combined variant's done set from Fokus (public.exercise_set_parts, slice
 * combo-parts), the app's fourth write: one bulk upsert of every part. The client sends the date,
 * session, the set and each part's kg, reps and per-side; the variant, refusals and the time are
 * the server's (lib/db/set-parts.ts).
 */
export async function setSetParts(raw: unknown): Promise<SetPartsResult> {
  const input = parseSetPartsInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordSetParts(input, new Date());
}

/**
 * A working set's clip recorded in Fokus (public.video_clips, slice video-record), the app's fifth
 * write: one insert on conflict (id) do nothing. The client sends its uuid, the date, session, the
 * set and the duration; exercise and variant ids, refusals and recorded_at are the server's
 * (lib/db/video-clips.ts). Only metadata: the video never leaves the phone here.
 */
export async function saveClip(raw: unknown): Promise<SaveClipResult> {
  const input = parseSaveClipInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordClip(input, new Date());
}

/** A star on a clip (kept past 8 weeks): one PATCH of starred. */
export async function starClip(raw: unknown): Promise<StarClipResult> {
  const input = parseStarClipInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordStar(input);
}

/** The user's in/out on a clip (slice clip-handles): one PATCH of clip_in_s/clip_out_s; both numbers or both null. */
export async function setClipRange(raw: unknown): Promise<SetClipRangeResult> {
  const input = parseSetClipRangeInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordClipRange(input);
}

/**
 * The phone's automatic clip (slice clip-auto): one PATCH of auto_in_s/auto_out_s/auto_status/auto_run_ms.
 * The input holds exactly the clip id and those four values; landmarks and frames never leave the phone.
 */
export async function setClipAuto(raw: unknown): Promise<SetClipAutoResult> {
  const input = parseSetClipAutoInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordClipAuto(input);
}

/**
 * A committed manual cut (slice clip-trim), sent once Fortryd's window is over: one PATCH of the new
 * duration_s with clip_in_s/clip_out_s and auto_* null; refused unless 0 < new ≤ the row's duration_s.
 */
export async function trimClip(raw: unknown): Promise<TrimClipResult> {
  const input = parseTrimClipInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordClipTrim(input);
}

/** A clip deleted on the phone deletes its row: one DELETE, idempotent. */
export async function deleteClip(raw: unknown): Promise<DeleteClipResult> {
  const input = parseDeleteClipInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return removeClip(input);
}
