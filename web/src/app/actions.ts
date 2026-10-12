"use server";

import { recordSetTap, type SetTapResult } from "@/lib/db/set-log";
import { parseSetTapInput } from "@/lib/set-taps";

/**
 * A set timing tap from the Træning screens (public.exercise_set_log) — the app's only write.
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
