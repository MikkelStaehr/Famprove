/**
 * DEV_FIXTURE (CLAUDE.md › Dev switches): under `next dev` only, the data layer shows one of the
 * designed states so it can be screenshotted without touching the database.
 *   empty  every loader returns no rows (nothing is read)
 *   stale  real rows, with computed_at STALE_AGE_MS old (the "Opdateret" warning)
 *   error  every loader throws a PostgrestError (nothing is read)
 * Only under `next dev`: `nodeEnv` defaults to the literal `process.env.NODE_ENV`, which the build
 * inlines, so a production bundle compares "production" and never reads DEV_FIXTURE. An unknown
 * value is warned about, never silently ignored (a mislabelled screenshot would look real).
 */
import { PostgrestError } from "./postgrest.ts";

export type DevFixture = "empty" | "stale" | "error";

/** Three days: well past the 26 h staleness limit. */
export const STALE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function devFixture(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): DevFixture | null {
  if (nodeEnv !== "development") return null;
  const value = env.DEV_FIXTURE;
  if (value === "empty" || value === "stale" || value === "error") return value;
  if (value) console.warn(`DEV_FIXTURE=${value} ignored: expected empty, stale or error`);
  return null;
}

/** The error DEV_FIXTURE=error throws in place of reading `table`. */
export function fixtureError(table: string): PostgrestError {
  return new PostgrestError(table, null, `DEV_FIXTURE=error: ${table} was not read`);
}

/** computed_at for DEV_FIXTURE=stale: STALE_AGE_MS before `now`. */
export function staleComputedAt(now: Date): string {
  return new Date(now.getTime() - STALE_AGE_MS).toISOString();
}
