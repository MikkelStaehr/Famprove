"use server";

import { recordTap, type TapResult } from "@/lib/db/exercise-log";
import { parseTapInput } from "@/lib/exercise-taps";

/**
 * Today's exercise timing tap (public.exercise_log) — the app's only write. A Server Action is a
 * public POST endpoint: the deployment is behind Vercel Authentication (All Deployments), Next
 * checks Origin against Host, and every input is checked again here (shape) and in recordTap
 * (today's date, names in that session of the sheet). The client never sends a time.
 */
export async function logExerciseTap(raw: unknown): Promise<TapResult> {
  const input = parseTapInput(raw);
  if (input === null) return { ok: false, reason: "invalid" };
  return recordTap(input, new Date());
}
