/**
 * DEV_FIXTURE (CLAUDE.md › Dev switches): under `next dev` only, the data layer shows one of the
 * designed states so it can be screenshotted without touching the database.
 *   empty  every loader returns no rows (nothing is read)
 *   stale  real rows, with computed_at STALE_AGE_MS old (the "Opdateret" warning)
 *   error  every loader throws a PostgrestError (nothing is read)
 *   band   real rows, with an illustrative CTL/ATL/TSB spread on every `recent` prognose row and a
 *          `recent` entry (tss_low/tss_high, 4 weeks) for its sessions (load.md §10e), so the
 *          band can be screenshotted before 4 real weeks exist. Never a real estimate.
 * Only under `next dev`: `nodeEnv` defaults to the literal `process.env.NODE_ENV`, which the build
 * inlines, so a production bundle compares "production" and never reads DEV_FIXTURE. An unknown
 * value is warned about, never silently ignored (a mislabelled screenshot would look real).
 */
import { PostgrestError } from "./postgrest.ts";
import type { DailyProjectionRow, ProjectedSession } from "./rows.ts";

export type DevFixture = "empty" | "stale" | "error" | "band";

/** Three days: well past the 26 h staleness limit. */
export const STALE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function devFixture(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): DevFixture | null {
  if (nodeEnv !== "development") return null;
  const value = env.DEV_FIXTURE;
  if (value === "empty" || value === "stale" || value === "error" || value === "band") return value;
  if (value) console.warn(`DEV_FIXTURE=${value} ignored: expected empty, stale, error or band`);
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

/** Illustrative strength TSS for a `recent` session Python couldn't average (DEV_FIXTURE=band). */
const BAND_SESSION_TSS = 15;

function bandSession(s: ProjectedSession): ProjectedSession {
  if (s.method !== "recent") return s;
  const tss = s.tss ?? BAND_SESSION_TSS;
  return { ...s, tss, reason: null, tssBand: { low: tss * 0.75, high: tss * 1.3 }, recentWeeks: 4 };
}

/**
 * DEV_FIXTURE=band: each `recent` row gets low < value < high, growing with its distance (in
 * rows) from the block's end. Dev only; it exists so the band can be drawn before real data has it.
 * CTL grows 0.6/row (~18 wide by the window's end): with the y axis spanning ~±130 a CTL is ~0.6px
 * at 390px, and a band much thinner than that hides under the 2.5px CTL line.
 */
export function illustrativeBands(rows: readonly DailyProjectionRow[]): DailyProjectionRow[] {
  let n = 0;
  return rows.map((row) => {
    if (row.strengthMethod !== "recent") return row;
    n += 1;
    return {
      ...row,
      sessions: row.sessions.map(bandSession),
      ctlBand: { low: row.ctl - 0.25 * n, high: row.ctl + 0.35 * n },
      atlBand: { low: row.atl - 0.25 * n, high: row.atl + 0.35 * n },
      tsbBand: { low: row.tsb - 0.4 * n, high: row.tsb + 0.3 * n },
    };
  });
}
