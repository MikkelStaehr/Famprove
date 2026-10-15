"use server";

import { recordFtpChoice, undoFtpChoice } from "@/lib/db/ftp-ack";
import { recordSetTap, type SetTapResult } from "@/lib/db/set-log";
import { recordSupersetPair } from "@/lib/db/superset-pairs";
import { parseSupersetInput, type SupersetResult } from "@/lib/supersets";
import type { FtpChoiceResult, FtpUndoResult } from "@/lib/ftp-line";
import { parseSetTapInput } from "@/lib/set-taps";

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
