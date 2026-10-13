/**
 * DEV_FIXTURE (CLAUDE.md › Dev switches): under `next dev` only, the data layer shows one of the
 * designed states so it can be screenshotted without touching the database.
 *   empty  every loader returns no rows (nothing is read)
 *   stale  real rows, with computed_at STALE_AGE_MS old (the "Opdateret" warning)
 *   error  every loader throws a PostgrestError (nothing is read)
 *   band   real rows, with an illustrative CTL/ATL/TSB spread on every `recent` prognose row and a
 *          `recent` entry (tss_low/tss_high, 4 weeks) for its sessions (load.md §10e), so the
 *          band can be screenshotted before 4 real weeks exist. Never a real estimate.
 *   ef-few real /analyse rows with ef_ok kept on the latest EF_FEW_POINTS only (analyse.md §8),
 *          so the "too few endurance rides" state can be screenshotted. Other screens: real rows.
 *   lsrpe  real /analyse/styrke rows with the latest LSRPE_POINTS e1RM points per lift marked as
 *          logged-RPE (full colour), so that state can be screenshotted before real LSRPE exists.
 *          Illustrative only: the e1RM values are unchanged.
 *   midsession  real Træning rows with an illustrative set log for today: in every session of the
 *          week, the first MIDSESSION_DONE sets done (one every 3 minutes, the last 1:42 ago) and the
 *          next one skipped, so the overview and Fokus can be screenshotted mid-session without a
 *          write (taps are refused under a dev switch, lib/db/set-log.ts).
 *   answers  real /analyse rows with illustrative analysis_summary rows, all three in `answer`
 *          (eFTP flat, EF up, volume with a plan, 3 of 4 done; analyse.md §12d), so the normal
 *          state of the answer blocks can be screenshotted. The sentences are Python's (the
 *          contract fixture's), never real numbers. Other screens: real rows.
 * Only under `next dev`: `nodeEnv` defaults to the literal `process.env.NODE_ENV`, which the build
 * inlines, so a production bundle compares "production" and never reads DEV_FIXTURE. An unknown
 * value is warned about, never silently ignored (a mislabelled screenshot would look real).
 */
import { LIFTS } from "../lifts.ts";
import { PostgrestError } from "./postgrest.ts";
import type {
  AnalysisSummaryRow,
  DailyProjectionRow,
  IsoDate,
  PrescribedSetRow,
  ProjectedSession,
  RideMetricsRow,
  SetLogRow,
  StrengthWeekRow,
} from "./rows.ts";

export type DevFixture = "empty" | "stale" | "error" | "band" | "ef-few" | "lsrpe" | "midsession" | "answers";
const FIXTURES: readonly DevFixture[] = ["empty", "stale", "error", "band", "ef-few", "lsrpe", "midsession", "answers"];

/** DEV_FIXTURE=midsession: sets done per session before the skipped one. */
export const MIDSESSION_DONE = 3;

/**
 * An illustrative set log for `today` (DEV_FIXTURE=midsession): per session, in the sheet's order,
 * MIDSESSION_DONE sets done 3 minutes apart (the last one ending 102 s before `now`), then one
 * skipped. Never written anywhere.
 */
export function midsessionLog(sets: readonly PrescribedSetRow[], today: IsoDate, now: Date): SetLogRow[] {
  const bySession = new Map<number, PrescribedSetRow[]>();
  for (const s of sets) bySession.set(s.session, [...(bySession.get(s.session) ?? []), s]);
  const log: SetLogRow[] = [];
  for (const [session, rows] of bySession) {
    const ordered = rows.toSorted((a, b) => a.sheetRow - b.sheetRow || a.setNo - b.setNo);
    const at = (k: number) => new Date(now.getTime() - 102_000 - (MIDSESSION_DONE - k) * 180_000).toISOString();
    ordered.slice(0, MIDSESSION_DONE).forEach((s, k) =>
      log.push({ date: today, session, row: s.sheetRow, set: s.setNo, startedAt: at(k), endedAt: at(k + 1), skipped: false, updatedAt: at(k + 1) }),
    );
    const skipped = ordered[MIDSESSION_DONE];
    if (skipped !== undefined) {
      log.push({ date: today, session, row: skipped.sheetRow, set: skipped.setNo, startedAt: null, endedAt: null, skipped: true, updatedAt: at(MIDSESSION_DONE - 0.5) });
    }
  }
  return log;
}

/** Three days: well past the 26 h staleness limit. */
export const STALE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function devFixture(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): DevFixture | null {
  if (nodeEnv !== "development") return null;
  const value = env.DEV_FIXTURE;
  const known = FIXTURES.find((f) => f === value);
  if (known !== undefined) return known;
  if (value) console.warn(`DEV_FIXTURE=${value} ignored: expected ${FIXTURES.join(", ")}`);
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

/** DEV_FIXTURE=ef-few: EF points kept on the latest rides only. */
export const EF_FEW_POINTS = 3;

/**
 * DEV_FIXTURE=ef-few: rides (ascending by date) with ef_ok cleared on all but the latest
 * EF_FEW_POINTS EF points (and their trend and line breaks with it). Dev only.
 */
export function fewEfPoints(rides: readonly RideMetricsRow[]): RideMetricsRow[] {
  const keep = new Set(
    rides
      .filter((r) => r.efOk)
      .slice(-EF_FEW_POINTS)
      .map((r) => r.activityId),
  );
  return rides.map((r) =>
    r.efOk && !keep.has(r.activityId) ? { ...r, efOk: false, efTrend: null, efGapBefore: false } : r,
  );
}

/** DEV_FIXTURE=lsrpe: e1RM points per lift shown as logged-RPE. */
export const LSRPE_POINTS = 2;

/**
 * DEV_FIXTURE=lsrpe: weeks (ascending) with the latest LSRPE_POINTS e1RM points of each lift
 * marked as logged-RPE. Dev only; the values stay Python's.
 */
export function illustrativeLogged(weeks: readonly StrengthWeekRow[]): StrengthWeekRow[] {
  const keep = new Set<string>();
  for (const lift of LIFTS) {
    const points = weeks.filter((w) => w.lift === lift && w.e1rmKg !== null);
    for (const w of points.slice(-LSRPE_POINTS)) keep.add(`${w.weekStart}#${w.lift}`);
  }
  return weeks.map((w) => (keep.has(`${w.weekStart}#${w.lift}`) ? { ...w, e1rmRpeSource: "logged" } : w));
}

const NO_EXTRA = { haveN: null, needN: null, target: null, targetSince: null, plannedN: null, doneN: null } as const;

/**
 * DEV_FIXTURE=answers: the contract fixture's rows (tests/fixtures/analysis_summary.json: live eftp,
 * edges.ef_up, edges.volume_plan; a test holds them equal), as Python wrote them.
 */
export const ILLUSTRATIVE_ANSWERS: readonly AnalysisSummaryRow[] = [
  {
    ...NO_EXTRA,
    question: "eftp",
    asOf: "2026-10-13",
    computedAt: "2026-10-13T06:25:00+00:00",
    state: "answer",
    direction: "flat",
    value: 183,
    valueDate: "2026-10-11",
    compare: 188,
    compareDate: "2026-08-30",
    delta: -5,
    verdictText: "Uændret: −5 W på 6 uger (188 W, 30. aug.).",
    detailText: "Din top er 233 W fra 7. sep. 2025.",
  },
  {
    ...NO_EXTRA,
    question: "ef",
    asOf: "2026-10-13",
    computedAt: "2026-10-13T06:25:00+00:00",
    state: "answer",
    direction: "up",
    value: 1.2,
    valueDate: "2026-10-13",
    compare: 1.1,
    compareDate: "2026-09-01",
    delta: 0.1,
    haveN: 3,
    needN: 3,
    verdictText: "Ja: EF er steget fra 1,10 til 1,20 på 6 uger, så du træder flere watt for samme puls.",
    detailText: null,
  },
  {
    ...NO_EXTRA,
    question: "volume",
    asOf: "2026-10-13",
    computedAt: "2026-10-13T06:25:00+00:00",
    state: "answer",
    direction: "up",
    value: 3.1,
    valueDate: null,
    compare: 0,
    compareDate: "2026-08-17",
    delta: 3.1,
    target: 3,
    targetSince: "2026-10-13",
    plannedN: 4,
    doneN: 3,
    verdictText: "Ja: 3,1 t pr. uge mod målet på 3,0 t.",
    detailText: "3 af 4 planlagte ture er kørt de sidste 4 uger.",
  },
];

/**
 * DEV_FIXTURE=answers: ILLUSTRATIVE_ANSWERS with the real rows' as_of and computed_at (the
 * freshness line stays real). Dev only.
 */
export function illustrativeAnswers(real: readonly AnalysisSummaryRow[]): AnalysisSummaryRow[] {
  return ILLUSTRATIVE_ANSWERS.map((a) => {
    const r = real.find((x) => x.question === a.question);
    return r === undefined ? a : { ...a, asOf: r.asOf, computedAt: r.computedAt };
  });
}
