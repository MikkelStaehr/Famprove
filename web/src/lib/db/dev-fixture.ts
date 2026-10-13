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
 *   warmup / pause / exercise-end  real Træning rows with an illustrative set log for today
 *          (fokus-pause.md §8): "Begynd træning" just tapped (Variant A with a ramp); set 1 of a
 *          range exercise done 2:10 ago, with a note (Variant B before the minimum); the last set of
 *          a range exercise done, the next run's warm-up started, with a ramp and a 2-line note
 *          (Variant C, the fold's worst case). Ramps, rests and notes the real rows lack are
 *          illustrative, never real suggestions.
 *   feel   /analyse/styrke with two illustrative exercise_feel rows (Python's sentence form).
 *   midsession also gives planned rows an adjustment (+2,5, a capped +2,5, a hold) and a note.
 *   answers  real /analyse rows with illustrative analysis_summary rows, all three in `answer`
 *          (eFTP flat, EF up, volume with a plan, 3 of 4 done; analyse.md §12d), so the normal
 *          state of the answer blocks can be screenshotted. The sentences are Python's (the
 *          contract fixture's), never real numbers. Other screens: real rows.
 * Only under `next dev`: `nodeEnv` defaults to the literal `process.env.NODE_ENV`, which the build
 * inlines, so a production bundle compares "production" and never reads DEV_FIXTURE. An unknown
 * value is warned about, never silently ignored (a mislabelled screenshot would look real).
 */
import { LIFTS } from "../lifts.ts";
import { sessionOrderWithWarmups, setKey, type SetRef } from "../set-taps.ts";
import { PostgrestError } from "./postgrest.ts";
import type {
  AnalysisSummaryRow,
  DailyProjectionRow,
  ExerciseFeelRow,
  IsoDate,
  PlannedSetRow,
  PrescribedSetRow,
  ProjectedSession,
  RideMetricsRow,
  SetLogRow,
  StrengthWeekRow,
} from "./rows.ts";

export type DevFixture =
  | "empty"
  | "stale"
  | "error"
  | "band"
  | "ef-few"
  | "lsrpe"
  | "midsession"
  | "answers"
  | "warmup"
  | "pause"
  | "exercise-end"
  | "feel";
const FIXTURES: readonly DevFixture[] = [
  "empty",
  "stale",
  "error",
  "band",
  "ef-few",
  "lsrpe",
  "midsession",
  "answers",
  "warmup",
  "pause",
  "exercise-end",
  "feel",
];

/** The Fokus pause fixtures (fokus-pause.md §8). */
export type PauseFixture = "warmup" | "pause" | "exercise-end";
export function isPauseFixture(f: DevFixture | null): f is PauseFixture {
  return f === "warmup" || f === "pause" || f === "exercise-end";
}

const RANGE = /^\s*\d+\s*[-–]\s*\d+\s*$/;
const NOTE_SHORT = "Palloff + GHD";
const NOTE_LONG = "Hold pausen i bunden et sekund, og stop sættet, hvis ryggen runder. Palloff + GHD efter sidste sæt.";
const FIXTURE_RAMP_BASIS_KG = 100; // only when the real row has no suggestion to ramp from

/** An illustrative 40/60/80 % ramp of `kg`, rounded to 2.5 (dev only; Python owns the real one). */
function illustrativeRamp(kg: number): PlannedSetRow["ramp"] {
  return [
    { pct: 40, reps: 5 },
    { pct: 60, reps: 3 },
    { pct: 80, reps: 2 },
  ].map((r) => ({ ...r, kg: Math.round((kg * r.pct) / 100 / 2.5) * 2.5 }));
}

function plannedFor(s: PrescribedSetRow, planned: readonly PlannedSetRow[]): PlannedSetRow {
  return (
    planned.find((p) => p.block === s.block && p.sheetRow === s.sheetRow && p.week === s.week && p.setNo === s.setNo) ?? {
      block: s.block,
      sheetRow: s.sheetRow,
      week: s.week,
      setNo: s.setNo,
      suggestedKg: null,
      basis: "no_lift",
      uncappedKg: null,
      adjustmentKg: null,
      adjustmentReason: null,
      restMinS: null,
      restMaxS: null,
      ramp: null,
    }
  );
}

/**
 * The Træning data for a pause fixture: the set log, and planned rows / sets with the ramp, rest
 * and note each state needs. `now` anchors the times. Nothing is written anywhere.
 */
export function pauseFixture(
  fixture: PauseFixture,
  sets: readonly PrescribedSetRow[],
  planned: readonly PlannedSetRow[],
  today: IsoDate,
  now: Date,
): { sets: PrescribedSetRow[]; plannedSets: PlannedSetRow[]; setLog: SetLogRow[] } {
  const outSets = [...sets];
  const outPlanned = new Map(planned.map((p) => [`${p.block}#${p.sheetRow}#${p.week}#${p.setNo}`, p]));
  const patch = (s: PrescribedSetRow, change: Partial<PlannedSetRow>) => {
    const p = plannedFor(s, planned);
    outPlanned.set(`${p.block}#${p.sheetRow}#${p.week}#${p.setNo}`, { ...p, ...change });
  };
  const note = (row: PrescribedSetRow, text: string) => {
    for (let i = 0; i < outSets.length; i += 1) {
      const s = outSets[i];
      if (s.session === row.session && s.sheetRow === row.sheetRow) outSets[i] = { ...s, notes: text };
    }
  };
  const log: SetLogRow[] = [];
  const t = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000).toISOString();
  const bySession = new Map<number, PrescribedSetRow[]>();
  for (const s of sets) bySession.set(s.session, [...(bySession.get(s.session) ?? []), s]);
  for (const [session, rows] of bySession) {
    const byKey = new Map(rows.map((r) => [setKey({ row: r.sheetRow, set: r.setNo }), r]));
    const order = sessionOrderWithWarmups(rows.map((r) => ({ ref: { row: r.sheetRow, set: r.setNo }, name: r.name })));
    const rowOf = (ref: SetRef) => byKey.get(setKey({ row: ref.row, set: Math.max(1, ref.set) }));
    const rampOn = (ref: SetRef) => {
      const r = rowOf(ref);
      if (r === undefined) return;
      const p = plannedFor(r, planned);
      if (p.ramp === null) patch(r, { ramp: illustrativeRamp(p.suggestedKg ?? r.loggedKg ?? FIXTURE_RAMP_BASIS_KG) });
    };
    // Every item before `upTo` (exclusive) done, 3 minutes apart, the last ending `endAgo` s ago.
    const doneUpTo = (upTo: number, endAgo: number) => {
      for (let k = 0; k < upTo; k += 1) {
        const ref = order[k];
        const end = endAgo + (upTo - 1 - k) * 180;
        const r = rowOf(ref);
        const top = r !== null && r !== undefined && RANGE.test(r.repsText ?? "") ? Number((r.repsText ?? "").split(/[-–]/)[1]) : null;
        log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: t(end + 180), endedAt: t(end), skipped: false, updatedAt: t(end), feltRpe: null, repsDone: ref.set === 0 ? null : top });
      }
    };
    const startOpen = (ref: SetRef, ago: number) =>
      log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: t(ago), endedAt: null, skipped: false, updatedAt: t(ago), feltRpe: null, repsDone: null });
    if (fixture === "warmup") {
      startOpen(order[0], 40);
      rampOn(order[0]);
      continue;
    }
    if (fixture === "pause") {
      // Set 1 of the first range row with 2+ sets (else the first set) done 2:10 ago.
      const i = order.findIndex((ref) => ref.set === 1 && RANGE.test(rowOf(ref)?.repsText ?? "") && byKey.has(setKey({ row: ref.row, set: 2 })));
      const at = i === -1 ? order.findIndex((ref) => ref.set === 1) : i;
      doneUpTo(at + 1, 130);
      const next = order[at + 1];
      if (next !== undefined) startOpen(next, 130);
      const r = rowOf(order[at]);
      if (r !== undefined) {
        note(r, NOTE_SHORT);
        for (const s of rows.filter((x) => x.sheetRow === r.sheetRow)) {
          patch(s, { restMinS: 180, restMaxS: 300 }); // 3–5 min, so 2:10 is before the minimum
        }
      }
      continue;
    }
    // exercise-end: the last set before a later warm-up whose row is a range row, else any.
    const warmups = order.map((ref, k) => [ref, k] as const).filter(([ref, k]) => ref.set === 0 && k > 0);
    const main = (ref: SetRef) => /^(squat|bench|bænkpres|deadlift|dødløft)\b/i.test(rowOf(ref)?.name.trim() ?? "");
    const ranged = warmups.filter(([, k]) => RANGE.test(rowOf(order[k - 1])?.repsText ?? ""));
    const pick = ranged.find(([ref]) => main(ref)) ?? ranged[0] ?? warmups[0];
    if (pick === undefined) continue;
    const [warm, k] = pick;
    doneUpTo(k, 40);
    startOpen(warm, 40);
    rampOn(warm);
    const next = rowOf(warm);
    if (next !== undefined) note(next, NOTE_LONG);
  }
  return { sets: outSets, plannedSets: [...outPlanned.values()], setLog: log };
}

/**
 * DEV_FIXTURE=midsession's planned rows: the first three rows with a suggestion get +2,5
 * (lettere), a capped +2,5, and a hold; the fourth row gets a note. Illustrative only.
 */
export function midsessionPlanned(
  sets: readonly PrescribedSetRow[],
  planned: readonly PlannedSetRow[],
): { sets: PrescribedSetRow[]; plannedSets: PlannedSetRow[] } {
  // The first three sheet rows; a row without a real suggestion gets an illustrative one.
  // Per session: a week's sessions are different sheet rows.
  const rowsOf = (session: number) =>
    [...new Set(sets.filter((s) => s.session === session).map((s) => s.sheetRow))].toSorted((a, b) => a - b);
  const changes: Partial<PlannedSetRow>[] = [
    { adjustmentKg: 2.5, adjustmentReason: "de sidste to var lettere" },
    { adjustmentKg: 2.5, adjustmentReason: "du ramte 10 reps to gange" },
    { adjustmentKg: 0, adjustmentReason: "de sidste to var hårdere" },
  ];
  const out = new Map(planned.map((p) => [`${p.block}#${p.sheetRow}#${p.week}#${p.setNo}`, p]));
  for (const s of sets) {
    const i = rowsOf(s.session).indexOf(s.sheetRow);
    if (i === -1 || i > 2) continue;
    const p = plannedFor(s, planned);
    const kg = p.suggestedKg ?? s.loggedKg ?? FIXTURE_RAMP_BASIS_KG;
    const capped = i === 1 ? { uncappedKg: kg + 2.5 } : {};
    out.set(`${p.block}#${p.sheetRow}#${p.week}#${p.setNo}`, { ...p, suggestedKg: kg, basis: p.suggestedKg === null ? "rpe_e1rm" : p.basis, ...changes[i], ...capped });
  }
  return {
    sets: sets.map((s) => (rowsOf(s.session)[3] === s.sheetRow ? { ...s, notes: NOTE_SHORT } : s)),
    plannedSets: [...out.values()],
  };
}

/** DEV_FIXTURE=feel: two exercise_feel rows in Python's sentence form (not real verdicts). */
export const ILLUSTRATIVE_FEEL: readonly ExerciseFeelRow[] = [
  { exerciseId: -2, name: "Romanian deadlift", ratedN: 6, verdictText: "Du melder oftest som ventet – forslaget rammer trænerens RPE" },
  { exerciseId: -1, name: "Squat", ratedN: 12, verdictText: "Du melder oftest lettere end foreskrevet – forslaget ligger 5 kg over trænerens RPE" },
];

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
      log.push({ date: today, session, row: s.sheetRow, set: s.setNo, startedAt: at(k), endedAt: at(k + 1), skipped: false, updatedAt: at(k + 1), feltRpe: null, repsDone: null }),
    );
    const skipped = ordered[MIDSESSION_DONE];
    if (skipped !== undefined) {
      log.push({ date: today, session, row: skipped.sheetRow, set: skipped.setNo, startedAt: null, endedAt: null, skipped: true, updatedAt: at(MIDSESSION_DONE - 0.5), feltRpe: null, repsDone: null });
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
