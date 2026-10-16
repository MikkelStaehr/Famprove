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
 *          range exercise done 2:10 ago (Variant B before the minimum); the last set of a range
 *          exercise done, the next run's warm-up started, with a ramp (Variant C). Ramps and rests
 *          the real rows lack are illustrative, never real suggestions.
 *   pause-rated / finished  (fokus-round4.md §5) as `pause`, the done set 3:40 ago and rated
 *          Hårdere; every set tapped (2 skipped, warm-ups, reps_done on range sets, mixed ratings
 *          incl. unrated, rests 1:30–5:00 and one > 6 min), logged kg for the first exercise only.
 *   feel   /analyse/styrke with two illustrative exercise_feel rows (Python's sentence form).
 *   midsession also gives planned rows an adjustment (+2,5, a capped +2,5, a hold).
 *   answers  real /analyse rows with illustrative analysis_summary rows, all three in `answer`
 *          (eFTP flat, EF up, volume with a plan, 3 of 4 done; analyse.md §12d), so the normal
 *          state of the answer blocks can be screenshotted. The sentences are Python's (the
 *          contract fixture's), never real numbers. Other screens: real rows.
 *   calendar  real /load rows with the prognose's second ISO week made a calendar week
 *          (answers-round.md §1): its Tuesday a planned ride in intervals.icu with a load
 *          (CALENDAR_RIDE_TSS), its Thursday one without (the typical day's value, fallback), the
 *          other days no cycling; counts 2 rides, 1 week, 1 without load. Illustrative only: CTL,
 *          ATL and TSB are left as Python computed them.
 *   weekly_plan (/load's week card, every fixture but empty / error): the real rows, with the
 *          current week (the latest weekly_load week) given an illustrative remaining value when it
 *          has none (the view not yet applied, or nothing left this week), so "planned" can be
 *          screenshotted. Never a real estimate.
 *   ftp-warning / ftp-quiet  /load's FTP line (ftp-confirm.md §4): an illustrative ftp_status (and
 *          notice), credible and mismatched / not tested since 17 May; /analyse gets the same FTP
 *          (its FTP line, ftp-confirm.md §A); other screens: real rows.
 *   superset  real Træning rows with an illustrative superset today (two consecutive accessory
 *          runs per session), A1 and B1 done, resting before A2 (supersetFixture).
 *   superset-suggested  as superset, the pair a suggestion from 7 days ago, nothing done today.
 *          Under both, setSupersetPair and the taps write nothing (lib/db/superset-pairs.ts).
 * Only under `next dev`: `nodeEnv` defaults to the literal `process.env.NODE_ENV`, which the build
 * inlines, so a production bundle compares "production" and never reads DEV_FIXTURE. An unknown
 * value is warned about, never silently ignored (a mislabelled screenshot would look real).
 */
import { LIFTS } from "../lifts.ts";
import { sessionOrderWithWarmups, setKey, type SetRef } from "../set-taps.ts";
import { exerciseIdMap, exerciseIdOf, sessionRuns } from "../supersets.ts";
import { PostgrestError } from "./postgrest.ts";
import type {
  AnalysisSummaryRow,
  AppNoticeRow,
  DailyProjectionRow,
  ExerciseFeelRow,
  ExerciseIdRow,
  SupersetPairRow,
  FtpStatusRow,
  IsoDate,
  PlannedSetRow,
  PrescribedSetRow,
  ProjectedSession,
  RideMetricsRow,
  SetLogRow,
  StrengthWeekRow,
  WeeklyLoadRow,
  WeeklyPlanRow,
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
  | "pause-rated"
  | "finished"
  | "feel"
  | "calendar"
  | "ftp-warning"
  | "ftp-quiet"
  | "superset"
  | "superset-suggested";
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
  "pause-rated",
  "finished",
  "feel",
  "calendar",
  "ftp-warning",
  "ftp-quiet",
  "superset",
  "superset-suggested",
];

/** The Fokus pause fixtures (fokus-pause.md §8). */
export type PauseFixture = "warmup" | "pause" | "exercise-end" | "pause-rated" | "finished";
export function isPauseFixture(f: DevFixture | null): f is PauseFixture {
  return f === "warmup" || f === "pause" || f === "exercise-end" || f === "pause-rated" || f === "finished";
}

/** DEV_FIXTURE=pause-rated: the done set's age (3:40, between the 3:00 MIN and the 5:00 MAX). */
export const PAUSE_RATED_AGO_S = 220;
/**
 * DEV_FIXTURE=finished: the rest before each done tap (cycled; 1:30–5:00), one longer than 6 min
 * (FINISHED_LONG_REST_AT), and the ratings (cycled, null = unrated). Illustrative, never real.
 */
export const FINISHED_RESTS_S = [90, 150, 210, 300, 120, 240, 180] as const;
export const FINISHED_LONG_REST_AT = 5;
export const FINISHED_LONG_REST_S = 400;
export const FINISHED_FEELS = [0, -1, 0, 1, null, 0, 1] as const;

const RANGE = /^\s*\d+\s*[-–]\s*\d+\s*$/;
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
      todayKg: null,
      todayBasis: null,
    }
  );
}

/**
 * fokus-kg.md: illustrative today's kg so every caption can be shot. Per session, the sheet rows in
 * order: 1st "sheet", 2nd "e1rm" (~, the suggestion), 3rd "derived", 4th "last", 5th none; later
 * rows keep their own. Dev only; Python owns the real values (domain/today_kg.py).
 */
export function illustrativeToday(
  sets: readonly PrescribedSetRow[],
  planned: readonly PlannedSetRow[],
): PlannedSetRow[] {
  const rowsOf = (session: number) =>
    [...new Set(sets.filter((s) => s.session === session).map((s) => s.sheetRow))].toSorted((a, b) => a - b);
  const bases = ["sheet", "e1rm", "derived", "last", null] as const;
  const out = new Map(planned.map((p) => [`${p.block}#${p.sheetRow}#${p.week}#${p.setNo}`, p]));
  for (const s of sets) {
    const i = rowsOf(s.session).indexOf(s.sheetRow);
    if (i === -1 || i >= bases.length) continue;
    const p = out.get(`${s.block}#${s.sheetRow}#${s.week}#${s.setNo}`) ?? plannedFor(s, planned);
    const basis = bases[i];
    const kg = basis === "e1rm" ? (p.suggestedKg ?? s.loggedKg ?? FIXTURE_RAMP_BASIS_KG) : (s.loggedKg ?? p.suggestedKg ?? FIXTURE_RAMP_BASIS_KG);
    out.set(`${p.block}#${p.sheetRow}#${p.week}#${p.setNo}`, { ...p, todayKg: basis === null ? null : kg, todayBasis: basis });
  }
  return [...out.values()];
}

/**
 * The Træning data for a pause fixture: the set log, and planned rows with the ramp and rest each
 * state needs. `now` anchors the times. Nothing is written anywhere.
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
        log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: t(end + 180), endedAt: t(end), skipped: false, skippedAt: null, updatedAt: t(end), feltRpe: null, repsDone: ref.set === 0 ? null : top });
      }
    };
    const startOpen = (ref: SetRef, ago: number) =>
      log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: t(ago), endedAt: null, skipped: false, skippedAt: null, updatedAt: t(ago), feltRpe: null, repsDone: null });
    // Dev only: the competition lifts by name (the screen itself reads exercises.category).
    const main = (ref: SetRef) => /^(squat|bench|bænkpres|deadlift|dødløft)\b/i.test(rowOf(ref)?.name.trim() ?? "");
    if (fixture === "warmup") {
      startOpen(order[0], 40);
      if (main(order[0])) rampOn(order[0]);
      continue;
    }
    if (fixture === "finished") {
      finishedLog(order, rowOf, session, today, now, log);
      // Logged kg for the first exercise only (the sheet synced at 05/12/20): the rest is unknown.
      const first = rowOf(order[0])?.name.trim().toLowerCase();
      for (let i = 0; i < outSets.length; i += 1) {
        const x = outSets[i];
        if (x.session !== session) continue;
        const kg = x.name.trim().toLowerCase() === first ? (x.loggedKg !== null && x.loggedKg > 0 ? x.loggedKg : FIXTURE_RAMP_BASIS_KG) : null;
        outSets[i] = { ...x, loggedKg: kg };
      }
      continue;
    }
    if (fixture === "pause" || fixture === "pause-rated") {
      // Set 1 of the first range row with 2+ sets (else the first set) done 2:10 ago (pause-rated: 3:40, rated Hårdere).
      const i = order.findIndex((ref) => ref.set === 1 && RANGE.test(rowOf(ref)?.repsText ?? "") && byKey.has(setKey({ row: ref.row, set: 2 })));
      const at = i === -1 ? order.findIndex((ref) => ref.set === 1) : i;
      const ago = fixture === "pause-rated" ? PAUSE_RATED_AGO_S : 130;
      doneUpTo(at + 1, ago);
      if (fixture === "pause-rated") {
        const k = log.findIndex((l) => l.session === session && l.row === order[at].row && l.set === order[at].set);
        if (k !== -1) log[k] = { ...log[k], feltRpe: 1 };
      }
      const next = order[at + 1];
      if (next !== undefined) startOpen(next, ago);
      const r = rowOf(order[at]);
      if (r !== undefined) {
        for (const s of rows.filter((x) => x.sheetRow === r.sheetRow)) {
          patch(s, { restMinS: 180, restMaxS: 300 }); // 3–5 min, so 2:10 is before the minimum
        }
      }
      continue;
    }
    // exercise-end: the last set before a later warm-up whose row is a range row, else any.
    const warmups = order.map((ref, k) => [ref, k] as const).filter(([ref, k]) => ref.set === 0 && k > 0);
    const ranged = warmups.filter(([, k]) => RANGE.test(rowOf(order[k - 1])?.repsText ?? ""));
    const pick = ranged.find(([ref]) => main(ref)) ?? ranged[0] ?? warmups[0];
    if (pick === undefined) continue;
    const [warm, k] = pick;
    doneUpTo(k, 40);
    startOpen(warm, 40);
    if (main(warm)) rampOn(warm); // a ramp only ever on a main lift: an accessory's warm-up is timer only
  }
  return { sets: outSets, plannedSets: [...outPlanned.values()], setLog: log };
}

/**
 * DEV_FIXTURE=finished's set log for one session: every item of `order` tapped, warm-ups done,
 * the second set of the second run and the second-to-last set skipped (2 skips), reps_done on
 * range sets (the low end + 1, else the top), FINISHED_FEELS cycled on done sets, FINISHED_RESTS_S
 * between done taps (one FINISHED_LONG_REST_S), the last done 60 s before `now`. Written nowhere.
 */
function finishedLog(
  order: readonly SetRef[],
  rowOf: (ref: SetRef) => PrescribedSetRow | undefined,
  session: number,
  today: IsoDate,
  now: Date,
  log: SetLogRow[],
): void {
  const sets = order.map((ref, k) => [ref, k] as const).filter(([ref]) => ref.set > 0);
  const secondRun = sets.filter(([ref]) => ref.set === 2)[1] ?? sets[1];
  const skipAt = new Set([secondRun?.[1], sets.at(-2)?.[1]].filter((k): k is number => k !== undefined));
  let done = 0;
  const rests: number[] = order.map((_, k): number => (k === 0 || skipAt.has(k) ? 0 : k === FINISHED_LONG_REST_AT ? FINISHED_LONG_REST_S : FINISHED_RESTS_S[k % FINISHED_RESTS_S.length]));
  const totalS = rests.reduce((a, b) => a + b, 0);
  let clock = now.getTime() - (60 + totalS) * 1000;
  let previous = new Date(clock - 60_000).toISOString();
  order.forEach((ref, k) => {
    clock += rests[k] * 1000;
    const at = new Date(clock).toISOString();
    const start = previous;
    previous = at;
    if (skipAt.has(k)) {
      log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: null, endedAt: null, skipped: true, skippedAt: at, updatedAt: at, feltRpe: null, repsDone: null });
      return;
    }
    const r = rowOf(ref);
    const range = RANGE.test(r?.repsText ?? "") ? (r?.repsText ?? "").split(/[-–]/).map((x) => Number(x.trim())) : null;
    const repsDone = ref.set === 0 || range === null ? null : done % 2 === 0 ? range[1] : range[0] + 1;
    const feltRpe = ref.set === 0 ? null : FINISHED_FEELS[done % FINISHED_FEELS.length];
    if (ref.set > 0) done += 1;
    log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: start, endedAt: at, skipped: false, skippedAt: null, updatedAt: at, feltRpe, repsDone });
  });
}

/**
 * DEV_FIXTURE=midsession's planned rows: the first three rows with a suggestion get +2,5
 * (lettere), a capped +2,5, and a hold. Illustrative only.
 */
export function midsessionPlanned(
  sets: readonly PrescribedSetRow[],
  planned: readonly PlannedSetRow[],
): PlannedSetRow[] {
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
  return illustrativeToday(sets, [...out.values()]);
}

/** DEV_FIXTURE=feel: two exercise_feel rows in Python's sentence form (not real verdicts). */
export const ILLUSTRATIVE_FEEL: readonly ExerciseFeelRow[] = [
  // Python's own sentences (domain/set_feedback.exercise_feel; tests/fixtures/exercise_feel.json).
  { exerciseId: -2, name: "Low incline DB press", variantId: null, variant: null, ratedN: 6, verdictText: "Du melder oftest som foreskrevet." },
  { exerciseId: -1, name: "Squat", variantId: null, variant: null, ratedN: 12, verdictText: "Du melder oftest lettere end foreskrevet – forslaget ligger 5 kg over trænerens RPE." },
  // A named variant (variants.md §4): "Bicep of choice · DB Preacher Curl".
  { exerciseId: -3, name: "Bicep of choice", variantId: -1, variant: "DB Preacher Curl", ratedN: 4, verdictText: "Du melder oftest lettere end foreskrevet." },
];

/**
 * DEV_FIXTURE=midsession's variants (variants.md §5): the rows of MIDSESSION_VARIANTS' exercises,
 * this week's and last week's, get that variant; the one marked `fresh` has nothing from last week
 * (basis new_variant: its planned rows lose their suggestion, last week's rows keep no variant, so
 * no last week matches). Illustrative only; Python owns the real variants.
 */
export const MIDSESSION_VARIANTS: readonly { readonly exercise: string; readonly variantId: number; readonly variant: string; readonly fresh: boolean }[] = [
  { exercise: "tricep of choice", variantId: -1, variant: "Single arm cable triceps pushdown", fresh: false },
  { exercise: "bicep of choice", variantId: -2, variant: "DB Preacher Curl", fresh: true },
];

export function midsessionVariants(
  sets: readonly PrescribedSetRow[],
  previousWeek: readonly PrescribedSetRow[],
  planned: readonly PlannedSetRow[],
): { sets: PrescribedSetRow[]; previousWeek: PrescribedSetRow[]; plannedSets: PlannedSetRow[] } {
  const of = (s: PrescribedSetRow) => MIDSESSION_VARIANTS.find((v) => v.exercise === s.name.trim().toLowerCase());
  const named = (s: PrescribedSetRow): PrescribedSetRow => {
    const v = of(s);
    return v === undefined ? s : { ...s, variantId: v.variantId, variant: v.variant };
  };
  const fresh = new Set(sets.filter((s) => of(s)?.fresh === true).map((s) => `${s.block}#${s.sheetRow}#${s.week}`));
  return {
    sets: sets.map(named),
    previousWeek: previousWeek.map((s) => (of(s)?.fresh === true ? s : named(s))),
    plannedSets: planned.map((p) =>
      fresh.has(`${p.block}#${p.sheetRow}#${p.week}`)
        ? { ...p, suggestedKg: null, basis: "new_variant", uncappedKg: null, adjustmentKg: null, adjustmentReason: null }
        : p,
    ),
  };
}

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
      log.push({ date: today, session, row: s.sheetRow, set: s.setNo, startedAt: at(k), endedAt: at(k + 1), skipped: false, skippedAt: null, updatedAt: at(k + 1), feltRpe: null, repsDone: null }),
    );
    const skipped = ordered[MIDSESSION_DONE];
    if (skipped !== undefined) {
      log.push({ date: today, session, row: skipped.sheetRow, set: skipped.setNo, startedAt: null, endedAt: null, skipped: true, skippedAt: at(MIDSESSION_DONE - 0.5), updatedAt: at(MIDSESSION_DONE - 0.5), feltRpe: null, repsDone: null });
    }
  }
  return log;
}

/**
 * DEV_FIXTURE=superset / superset-suggested (slice supersets): per session of the week, the first
 * two consecutive runs that are not competition lifts (by name; dev only) and have 2+ sets each
 * become an illustrative pair. `superset`: chosen today, the log done up to and including B1 in
 * the paired order (warm-ups included, 3 minutes apart, the last 1:42 ago), so the screen rests
 * before A2. `superset-suggested`: a row from 7 days ago (paired), nothing logged today. Names
 * without a public.exercises id get an illustrative negative id. Never written anywhere.
 */
export function supersetFixture(
  fixture: "superset" | "superset-suggested",
  data: { readonly sets: readonly PrescribedSetRow[]; readonly exerciseIds?: readonly ExerciseIdRow[] },
  today: IsoDate,
  now: Date,
): { supersetPairs: SupersetPairRow[]; exerciseIds: ExerciseIdRow[]; setLog: SetLogRow[] } {
  const exerciseIds = [...(data.exerciseIds ?? [])];
  const known = exerciseIdMap(exerciseIds);
  for (const s of data.sets) {
    if (exerciseIdOf(known, s.name) === null) {
      const id = -(exerciseIds.length + 1);
      exerciseIds.push({ id, name: s.name.trim(), aliases: [] });
      known.set(s.name.trim().toLowerCase(), id);
    }
  }
  const pairs: SupersetPairRow[] = [];
  const log: SetLogRow[] = [];
  const bySession = new Map<number, PrescribedSetRow[]>();
  for (const s of data.sets) bySession.set(s.session, [...(bySession.get(s.session) ?? []), s]);
  for (const [session, rows] of bySession) {
    const runSets = rows.map((r) => ({ ref: { row: r.sheetRow, set: r.setNo }, name: r.name, variantId: r.variantId }));
    const runs = sessionRuns(runSets, known);
    const nameOf = (row: number) => rows.find((r) => r.sheetRow === row)?.name.trim() ?? "";
    const accessory = (row: number) => !/^(squat|bench|bænkpres|deadlift|dødløft)\b/i.test(nameOf(row));
    const i = runs.findIndex((a, k) => {
      const b = runs.at(k + 1);
      return b !== undefined && accessory(a.row) && accessory(b.row) && a.sets >= 2 && b.sets >= 2 && a.exerciseId !== null && b.exerciseId !== null;
    });
    const a = runs.at(i);
    const b = runs.at(i + 1);
    if (i === -1 || a === undefined || b === undefined || a.exerciseId === null || b.exerciseId === null) continue;
    const date = fixture === "superset" ? today : addDaysIso(today, -7);
    const at = new Date(now.getTime() - 3_600_000).toISOString();
    pairs.push({ date, session, rowA: a.row, rowB: b.row, exerciseA: a.exerciseId, variantA: a.variantId, exerciseB: b.exerciseId, variantB: b.variantId, paired: true, updatedAt: at });
    if (fixture !== "superset") continue;
    const order = sessionOrderWithWarmups(runSets, [{ rowA: a.row, rowB: b.row }]);
    const upTo = order.findIndex((r) => r.row === b.row && r.set === 1) + 1; // through B1
    const t = (k: number) => new Date(now.getTime() - 102_000 - (upTo - 1 - k) * 180_000).toISOString();
    order.slice(0, upTo).forEach((ref, k) =>
      log.push({ date: today, session, row: ref.row, set: ref.set, startedAt: new Date(Date.parse(t(k)) - 180_000).toISOString(), endedAt: t(k), skipped: false, skippedAt: null, updatedAt: t(k), feltRpe: null, repsDone: null }),
    );
  }
  return { supersetPairs: pairs, exerciseIds, setLog: log };
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/**
 * Under `next dev` with DEV_TODAY or DEV_FIXTURE the screen is not today's or not real: every write
 * path (set taps, the FTP answer) and the refresh route start nothing. The one copy of this guard.
 */
export function devSwitchOn(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development" && (Boolean(env.DEV_TODAY) || devFixture(env, nodeEnv) !== null);
}

/** The error DEV_FIXTURE=error throws in place of reading `table`. */
export function fixtureError(table: string): PostgrestError {
  return new PostgrestError(table, null, `DEV_FIXTURE=error: ${table} was not read`);
}

/**
 * DEV_FIXTURE=ftp-warning / ftp-quiet (ftp-confirm.md §4): /load's FTP line without the real
 * ftp_status (illustrative, never written; a tap under a fixture writes nothing).
 * ftp-warning: credible, FTP 230 W vs eFTP 183 W, not suppressed; ftp-quiet: not tested since 17 May.
 */
export function illustrativeFtp(
  fixture: "ftp-warning" | "ftp-quiet",
  now: Date,
): { readonly status: FtpStatusRow; readonly notice: AppNoticeRow | null } {
  const status: FtpStatusRow = {
    ftpW: 230,
    eftpW: 183,
    credible: fixture === "ftp-warning",
    lastTestedOn: fixture === "ftp-warning" ? "2026-10-04" : "2026-05-17",
    ftpSince: "2026-03-21",
    suppressedUntil: null,
  };
  const notice: AppNoticeRow | null =
    fixture === "ftp-warning"
      ? { kind: "ftp_mismatch", date: "2026-10-15", message: "FTP er sat til 230 W, men dine ture peger på 183 W", updatedAt: now.toISOString() }
      : null;
  return { status, notice };
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

/** DEV_FIXTURE=calendar: the illustrative load of the planned ride with a load. */
export const CALENDAR_RIDE_TSS = 45;

/** ISO weekday 1..7 of a YYYY-MM-DD date (UTC, no time of day). */
function isoWeekday(date: IsoDate): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * DEV_FIXTURE=calendar: the second Monday-to-Sunday week of the prognose becomes a calendar week
 * (Tuesday: a ride with CALENDAR_RIDE_TSS; Thursday: a ride without a load, which keeps the typical
 * day's value). Dev only; never a real estimate.
 */
export function illustrativeCalendar(rows: readonly DailyProjectionRow[]): DailyProjectionRow[] {
  const mondays = rows.filter((r) => isoWeekday(r.date) === 1).map((r) => r.date);
  const start = mondays[1] ?? mondays[0];
  if (start === undefined) return [...rows];
  const end = rows.find((r) => r.date > start && isoWeekday(r.date) === 7)?.date ?? start;
  const calendar = { rides: 2, weeks: 1, noLoad: 1 };
  return rows.map((row) => {
    if (row.date < start || row.date > end) return row;
    const day = isoWeekday(row.date);
    const base = { ...row, cyclingSource: "calendar" as const, rides: [], calendar, typicalFallback: false };
    if (day === 2) return { ...base, cyclingTss: CALENDAR_RIDE_TSS, events: [{ name: "Zwift · Z2 75 min", tss: CALENDAR_RIDE_TSS, reason: null }] };
    if (day === 4) return { ...base, typicalFallback: true, events: [{ name: "Udendørs tur", tss: null, reason: null }] };
    return { ...base, cyclingTss: 0, events: [] };
  });
}

/** Illustrative TSS still to come in the current week (dev only; Python's prognose owns the real one). */
export const ILLUSTRATIVE_REMAINING_TSS = 96;

/**
 * Any DEV_FIXTURE but empty / error: `real` weekly_plan rows (null: the read failed, e.g. the view
 * isn't applied yet), with the current week (the latest weekly_load row) given
 * ILLUSTRATIVE_REMAINING_TSS when it has no remaining value. Done TSS is the week's own total.
 */
export function illustrativeWeeklyPlan(
  weeks: readonly WeeklyLoadRow[],
  real: readonly WeeklyPlanRow[] | null,
): WeeklyPlanRow[] {
  const rows = [...(real ?? [])];
  const current = weeks.at(-1);
  if (current === undefined) return rows;
  const at = rows.findIndex((r) => r.weekStart === current.weekStart);
  if (at !== -1 && rows[at].remainingTss !== null) return rows;
  const doneTss = at === -1 ? current.totalTss : rows[at].doneTss;
  const row: WeeklyPlanRow = {
    weekStart: current.weekStart,
    weekEnd: current.weekEnd,
    isoYear: current.isoYear,
    isoWeek: current.isoWeek,
    doneTss,
    remainingTss: ILLUSTRATIVE_REMAINING_TSS,
    plannedTss: doneTss + ILLUSTRATIVE_REMAINING_TSS,
  };
  if (at === -1) rows.push(row);
  else rows[at] = row;
  return rows.sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
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
