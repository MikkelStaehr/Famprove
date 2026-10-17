import "server-only";

import { isDataError } from "../data-error.ts";

import { connection } from "next/server";

import {
  devFixture,
  fewEfPoints,
  fixtureError,
  illustrativeAnswers,
  illustrativeBands,
  illustrativeCalendar,
  illustrativeFtp,
  illustrativeLogged,
  illustrativeWeeklyPlan,
  ILLUSTRATIVE_FEEL,
  isPauseFixture,
  midsessionLog,
  comboSets,
  jumpedFixture,
  supersetOfferLog,
  supersetFixture,
  illustrativeToday,
  midsessionPlanned,
  midsessionVariants,
  pauseFixture,
  staleComputedAt,
} from "./dev-fixture.ts";
import { readSupabaseEnv } from "./env.ts";
import { createClient, selectAll, selectFirst } from "./postgrest.ts";
import { addDays, isoWeekStart } from "../dates.ts";
import { withoutSkipped } from "../training-view.ts";
import {
  ANALYSIS_SUMMARY_SELECT,
  parseAnalysisSummaryRow,
  ACTIVITIES_SELECT,
  APP_NOTICES_SELECT,
  parseAppNoticeRow,
  FTP_ACK_SELECT,
  FTP_STATUS_SELECT,
  parseFtpAckRow,
  parseFtpStatusRow,
  BLOCKS_SELECT,
  CYCLING_WEEKS_SELECT,
  DAILY_LOAD_SELECT,
  ISO_DATE,
  parseActivityRow,
  parsePlannedSetRow,
  parsePlannedTargetRow,
  parsePrescribedSetRow,
  parseSetLogRow,
  parseExerciseFeelRow,
  EXERCISE_FEEL_SELECT,
  EXERCISE_CATEGORY_SELECT,
  parseExerciseCategoryRow,
  PLANNED_SETS_SELECT,
  PLANNED_TARGETS_SELECT,
  PRESCRIBED_SETS_SELECT,
  SET_LOG_SELECT,
  SESSION_ORDER_SELECT,
  SUPERSET_PAIRS_SELECT,
  parseSessionOrderRow,
  parseSupersetPairRow,
  EXERCISE_IDS_SELECT,
  parseExerciseIdRow,
  parseBlockRow,
  parseCyclingWeekRow,
  parseDailyLoadRow,
  parseRideMetricsRow,
  parseRideViRow,
  parseProjectionRow,
  parseStrengthSessionRow,
  PROJECTION_SELECT,
  RIDE_METRICS_SELECT,
  RIDE_VI_SELECT,
  SHEET_ONE_RM_SELECT,
  STRENGTH_BLOCKS_SELECT,
  STRENGTH_WEEKS_SELECT,
  parseSheetOneRmRow,
  parseStrengthBlockRow,
  parseStrengthWeekRow,
  parseStrengthSetRow,
  parseWeeklyLoadRow,
  parseWeeklyPlanRow,
  STRENGTH_SESSIONS_SELECT,
  STRENGTH_SETS_SELECT,
  WEEKLY_LOAD_SELECT,
  WEEKLY_PLAN_SELECT,
} from "./rows.ts";
import type {
  AppNoticeRow,
  CyclingAnalysisData,
  FtpAckRow,
  FtpStatusRow,
  StrengthAnalysisData,
  DashboardData,
  DailyLoadRow,
  ExerciseCategoryRow,
  ExerciseFeelRow,
  ExerciseIdRow,
  SessionOrderRow,
  SupersetPairRow,
  IsoDate,
  PlannedSetRow,
  PlannedTargetRow,
  PrescribedSetRow,
  SetLogRow,
  StrengthSessionRow,
  WeekDetailData,
  WeeklyPlanRow,
} from "./rows.ts";

/** Call only after `await connection()`: reads env at request time. */
function client() {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

/**
 * Hero, chart and week totals. Reads, never writes.
 *
 * 1. `await connection()` FIRST: marks the route request-time (no prerender at `next build`,
 *    so CI builds without secrets) and makes process.env be read at runtime.
 * 2. readSupabaseEnv() -> createClient(url, key, globalThis.fetch).
 * 3. In parallel, selectAll over DAILY_LOAD_SELECT, BLOCKS_SELECT, WEEKLY_LOAD_SELECT with
 *    the matching parse*Row. No filters: daily_load holds exactly SERIES_START .. compute
 *    day by construction; blocks and weekly_load are tiny. "This week" is picked later from
 *    the latest daily row (dashboard-view.ts), never from the server clock.
 * 4. The prognose and weekly_plan are secondary reads alongside (null on failure: /load still
 *    renders; without weekly_plan the week card shows done TSS only).
 *
 * Throws EnvError / PostgrestError / RowError; the page catches and renders ErrorState.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  await connection();
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(DAILY_LOAD_SELECT.table);
  if (fixture === "empty") return { daily: [], blocks: [], weeks: [], projection: [], weeklyPlan: [] };
  const db = client();
  // The prognose is secondary: if it can't be read, the rest of /load still renders (null).
  // It is read alongside the rest, with its own catch.
  const projectionRead = selectAll(db, PROJECTION_SELECT.table, PROJECTION_SELECT, parseProjectionRow).catch(
    (error: unknown) => {
      console.error("dashboard: loading the projection failed", error);
      return null;
    },
  );
  // weekly_plan likewise (and, until its migration is applied, a 404 lands here): null = done only.
  const weeklyPlanRead = selectAll(db, WEEKLY_PLAN_SELECT.table, WEEKLY_PLAN_SELECT, parseWeeklyPlanRow).then(
    (rows): readonly WeeklyPlanRow[] | null => rows,
    (error: unknown) => {
      if (!isDataError(error)) throw error;
      console.error("dashboard: loading weekly_plan failed", error);
      return null;
    },
  );
  // Promise.all also awaits the secondary reads when a main read fails first (no unhandled rejection).
  const [daily, blocks, weeks, read, planRead] = await Promise.all([
    selectAll(db, DAILY_LOAD_SELECT.table, DAILY_LOAD_SELECT, parseDailyLoadRow),
    selectAll(db, BLOCKS_SELECT.table, BLOCKS_SELECT, parseBlockRow),
    selectAll(db, WEEKLY_LOAD_SELECT.table, WEEKLY_LOAD_SELECT, parseWeeklyLoadRow),
    projectionRead,
    weeklyPlanRead,
  ]);
  const projection =
    read === null ? read : fixture === "band" ? illustrativeBands(read) : fixture === "calendar" ? illustrativeCalendar(read) : read;
  // Under any other dev fixture the current week shows a planned value (dev-fixture.ts).
  const weeklyPlan = fixture === null ? planRead : illustrativeWeeklyPlan(weeks, planRead);
  if (fixture === "stale") {
    const computedAt = staleComputedAt(new Date());
    return { daily: daily.map((d) => ({ ...d, computedAt })), blocks, weeks, projection, weeklyPlan };
  }
  return { daily, blocks, weeks, projection, weeklyPlan };
}

/**
 * The current notices (app_notices, e.g. FTP vs eFTP). Advisory: a failed read is logged and
 * shows no notice instead of failing /load. Under DEV_FIXTURE empty / error: none.
 */
export async function loadAppNotices(): Promise<readonly AppNoticeRow[]> {
  await connection();
  const fixture = devFixture();
  if (fixture === "empty" || fixture === "error") return [];
  try {
    return await selectAll(client(), APP_NOTICES_SELECT.table, APP_NOTICES_SELECT, parseAppNoticeRow);
  } catch (error) {
    if (!isDataError(error)) throw error;
    console.error("load: reading app_notices failed", error);
    return [];
  }
}

/**
 * The FTP line's inputs (slice ftp-confirm): Python's ftp_status and the user's newest answer (the
 * ftp_mismatch notice itself comes with loadAppNotices). Reads only; a failed read shows no line
 * (never a guessed FTP). DEV_FIXTURE ftp-warning / ftp-quiet give an illustrative status and notice.
 */
export async function loadFtpCheck(): Promise<{
  readonly status: FtpStatusRow | null;
  readonly latestAck: FtpAckRow | null;
  readonly fixtureNotice: AppNoticeRow | null | undefined; // undefined = use the real notices
}> {
  await connection();
  const fixture = devFixture();
  if (fixture === "empty" || fixture === "error") return { status: null, latestAck: null, fixtureNotice: undefined };
  if (fixture === "ftp-warning" || fixture === "ftp-quiet") {
    const { status, notice } = illustrativeFtp(fixture, new Date());
    return { status, latestAck: null, fixtureNotice: notice };
  }
  try {
    const c = client();
    const [status, latestAck] = await Promise.all([
      selectFirst(c, FTP_STATUS_SELECT.table, FTP_STATUS_SELECT, parseFtpStatusRow),
      selectFirst(c, FTP_ACK_SELECT.table, FTP_ACK_SELECT, parseFtpAckRow),
    ]);
    return { status, latestAck, fixtureNotice: undefined };
  } catch (error) {
    if (!isDataError(error)) throw error;
    console.error("load: reading ftp_status / ftp_ack failed", error);
    return { status: null, latestAck: null, fixtureNotice: undefined };
  }
}

/**
 * Rides and strength sessions done inside [start, end] (a weekly_load row's ISO week, never
 * raw user input), plus that week's prescribed sets for the sessions' exercises. Reads only.
 * Throws EnvError / PostgrestError / RowError like loadDashboardData.
 */
export async function loadWeekDetail(start: IsoDate, end: IsoDate): Promise<WeekDetailData> {
  await connection();
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || end < start) {
    throw new RangeError("loadWeekDetail: invalid week range");
  }
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(ACTIVITIES_SELECT.table);
  if (fixture === "empty") return { activities: [], rideVi: [], sessions: [], sets: [] };
  const db = client();
  const [activities, rideVi, sessions, sets] = await Promise.all([
    selectAll(
      db,
      ACTIVITIES_SELECT.table,
      {
        ...ACTIVITIES_SELECT,
        filters: [
          ["start_date_local", `gte.${start}T00:00:00`],
          ["start_date_local", `lt.${addDays(end, 1)}T00:00:00`],
        ],
      },
      parseActivityRow,
    ),
    selectAll(
      db,
      RIDE_VI_SELECT.table,
      { ...RIDE_VI_SELECT, filters: [["date", `gte.${start}`], ["date", `lte.${end}`]] },
      parseRideViRow,
    ),
    selectAll(
      db,
      STRENGTH_SESSIONS_SELECT.table,
      { ...STRENGTH_SESSIONS_SELECT, filters: [["date", `gte.${start}`], ["date", `lte.${end}`]] },
      parseStrengthSessionRow,
    ),
    selectAll(
      db,
      STRENGTH_SETS_SELECT.table,
      {
        ...STRENGTH_SETS_SELECT,
        filters: [["week_start", `gte.${isoWeekStart(start)}`], ["week_start", `lte.${end}`]],
      },
      parseStrengthSetRow,
    ),
  ]);
  return { activities, rideVi, sessions, sets };
}

/** Days ahead the rest state looks for the next planned ride. */
export const NEXT_SESSION_DAYS = 28;

/** The form line: the latest daily_load row on or before `today` (null when none). */
export async function loadTrainingForm(today: IsoDate): Promise<DailyLoadRow | null> {
  await connection();
  if (!ISO_DATE.test(today)) throw new RangeError("loadTrainingForm: invalid date");
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(DAILY_LOAD_SELECT.table);
  if (fixture === "empty") return null;
  const latest = await selectFirst(
    client(),
    DAILY_LOAD_SELECT.table,
    { ...DAILY_LOAD_SELECT, order: "date.desc", filters: [["date", `lte.${today}`]] },
    parseDailyLoadRow,
  );
  return fixture === "stale" && latest !== null
    ? { ...latest, computedAt: staleComputedAt(new Date()) }
    : latest;
}

/** Everything the Træning screen's plan reads for one local date (form is loaded separately). */
export type TrainingPlanData = {
  readonly weekStart: IsoDate; // Monday of today's ISO week
  readonly sessions: readonly StrengthSessionRow[]; // this ISO week: planned, done and extra
  readonly sets: readonly PrescribedSetRow[]; // this ISO week's prescription, every session
  readonly previousWeek: readonly PrescribedSetRow[]; // same tabs, week - 1 (references)
  readonly rides: readonly PlannedTargetRow[]; // planned rides today
  readonly upcomingRides: readonly PlannedTargetRow[]; // planned rides in (today, today + 28]
  readonly plannedSets: readonly PlannedSetRow[]; // suggested kg per set, this ISO week (Python)
  readonly setLog: readonly SetLogRow[]; // today's logged sets, every session (exercise_set_log)
  readonly setLogFailed: boolean; // the set log couldn't be read: sets show as open, with a warning
  /** superset_pairs up to today, every session (today's decide, earlier days suggest); absent = none read. */
  readonly supersetPairs?: readonly SupersetPairRow[];
  /** public.exercises ids by name and alias (superset runs are keyed by exercise id); absent = none read. */
  readonly exerciseIds?: readonly ExerciseIdRow[];
  /** Today's session_order rows, every session (a jump's run order); absent = none read (the sheet's order). */
  readonly sessionOrders?: readonly SessionOrderRow[];
};

/**
 * This ISO week's strength sessions and prescription (the view picks session k + 1), last
 * week's sets of the same tabs, planned rides and the next ones. `today` is a local date
 * chosen by the server (never raw user input); it is validated again here. Reads only;
 * throws EnvError / PostgrestError / RowError.
 */
export async function loadTrainingPlan(today: IsoDate): Promise<TrainingPlanData> {
  await connection();
  if (!ISO_DATE.test(today)) throw new RangeError("loadTrainingPlan: invalid date");
  const weekStart = isoWeekStart(today);
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(STRENGTH_SESSIONS_SELECT.table);
  if (fixture === "empty") {
    return {
      weekStart,
      sessions: [],
      sets: [],
      previousWeek: [],
      rides: [],
      upcomingRides: [],
      plannedSets: [],
      setLog: [],
      setLogFailed: false,
    };
  }
  const db = client();
  const horizon = addDays(today, NEXT_SESSION_DAYS);
  const [sessions, sets, rides, upcomingRides, plannedSets, setLog, supersetPairs, exerciseIds, sessionOrders] = await Promise.all([
    selectAll(
      db,
      STRENGTH_SESSIONS_SELECT.table,
      {
        ...STRENGTH_SESSIONS_SELECT,
        filters: [["week_start", `eq.${weekStart}`]],
      },
      parseStrengthSessionRow,
    ),
    selectAll(
      db,
      PRESCRIBED_SETS_SELECT.table,
      { ...PRESCRIBED_SETS_SELECT, filters: [["week_start", `eq.${weekStart}`]] },
      parsePrescribedSetRow,
    ),
    selectAll(
      db,
      PLANNED_TARGETS_SELECT.table,
      { ...PLANNED_TARGETS_SELECT, filters: [["date", `eq.${today}`]] },
      parsePlannedTargetRow,
    ),
    selectAll(
      db,
      PLANNED_TARGETS_SELECT.table,
      {
        ...PLANNED_TARGETS_SELECT,
        filters: [["date", `gt.${today}`], ["date", `lte.${horizon}`]],
      },
      parsePlannedTargetRow,
    ),
    selectAll(
      db,
      PLANNED_SETS_SELECT.table,
      { ...PLANNED_SETS_SELECT, filters: [["week_start", `eq.${weekStart}`]] },
      parsePlannedSetRow,
    ),
    // The set log is read on its own: if it fails, the plan still shows (every set open, a
    // warning) instead of the whole screen failing (spec traening.md §5).
    selectAll(db, SET_LOG_SELECT.table, { ...SET_LOG_SELECT, filters: [["date", `eq.${today}`]] }, parseSetLogRow).then(
      (rows): readonly SetLogRow[] | null => rows,
      (error: unknown) => {
        if (!isDataError(error)) throw error;
        console.error("training: reading the set log failed", error);
        return null;
      },
    ),
    // Supersets reorder the session; the server orders taps by the same rows, so they must be read
    // (a failure fails the plan rather than showing an order the server doesn't use).
    selectAll(db, SUPERSET_PAIRS_SELECT.table, { ...SUPERSET_PAIRS_SELECT, filters: [["date", `lte.${today}`]] }, parseSupersetPairRow),
    selectAll(db, EXERCISE_IDS_SELECT.table, EXERCISE_IDS_SELECT, parseExerciseIdRow),
    // A jump's run order: as the pairs, the server orders taps by it, so a failure fails the plan.
    selectAll(db, SESSION_ORDER_SELECT.table, { ...SESSION_ORDER_SELECT, filters: [["date", `eq.${today}`]] }, parseSessionOrderRow),
  ]);
  // Last week's sets of the same tab(s): one query per (tab, week - 1). Tab names come from
  // this week's rows (server data) and go through URLSearchParams as eq. values.
  const previousKeys = new Map<string, { block: string; week: number }>();
  for (const s of sets) {
    if (s.week > 1) {
      previousKeys.set(`${s.block}#${s.week - 1}`, { block: s.block, week: s.week - 1 });
    }
  }
  const [previous, lastWeekSkips] = await Promise.all([
    Promise.all(
      [...previousKeys.values()].map(({ block, week }) =>
        selectAll(
          db,
          PRESCRIBED_SETS_SELECT.table,
          { ...PRESCRIBED_SETS_SELECT, filters: [["block", `eq.${block}`], ["week", `eq.${week}`]] },
          parsePrescribedSetRow,
        ),
      ),
    ),
    // Last week's sets skipped in the app are no reference (withoutSkipped). If this read fails,
    // the references stay as the sheet has them and the failure is logged.
    selectAll(
      db,
      SET_LOG_SELECT.table,
      {
        ...SET_LOG_SELECT,
        filters: [["date", `gte.${addDays(weekStart, -7)}`], ["date", `lt.${weekStart}`], ["skipped", "eq.true"]],
      },
      parseSetLogRow,
    ).then(
      (rows): readonly SetLogRow[] => rows,
      (error: unknown) => {
        if (!isDataError(error)) throw error;
        console.error("training: reading last week's skipped sets failed", error);
        return [];
      },
    ),
  ]);
  const base = {
    weekStart,
    sessions,
    sets,
    previousWeek: withoutSkipped(previous.flat(), lastWeekSkips),
    rides,
    upcomingRides,
    plannedSets,
    setLog: setLog ?? [],
    setLogFailed: setLog === null,
    supersetPairs,
    exerciseIds,
    sessionOrders,
  };
  // Dev fixtures (never in production, never written): illustrative logs, ramps, adjustments.
  if (fixture === "superset" || fixture === "superset-suggested" || fixture === "sheet-superset") {
    return { ...base, ...supersetFixture(fixture === "sheet-superset" ? "superset" : fixture, base, today, new Date()) };
  }
  if (fixture === "midsession" || fixture === "sheet" || fixture === "combo") {
    const mid = midsessionVariants(sets, base.previousWeek, midsessionPlanned(sets, plannedSets));
    const shown = fixture === "combo" ? comboSets(mid.sets) : mid.sets;
    return { ...base, ...mid, sets: shown, setLog: midsessionLog(shown, today, new Date()) };
  }
  if (fixture === "jumped") {
    const mid = midsessionVariants(sets, base.previousWeek, midsessionPlanned(sets, plannedSets));
    return { ...base, ...mid, ...jumpedFixture(mid.sets, today, new Date()), supersetPairs: [] };
  }
  if (fixture === "superset-offer") return { ...base, setLog: supersetOfferLog(sets, today, new Date()), supersetPairs: [] };
  if (isPauseFixture(fixture)) {
    const pause = pauseFixture(fixture, sets, plannedSets, today, new Date());
    return { ...base, ...pause, plannedSets: illustrativeToday(pause.sets, pause.plannedSets) };
  }
  return base;
}

/**
 * /analyse (Cykel): every ride_metrics row and every cycling_weeks row (both tiny, both rebuilt
 * whole by compute, so no filters). Reads only. The weeks are secondary: if they can't be read,
 * the rides still render and that card shows its error (weeks = null).
 * Throws EnvError / PostgrestError / RowError for the rides; the page renders ErrorState.
 */
export async function loadCyclingAnalysis(): Promise<CyclingAnalysisData> {
  await connection();
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(RIDE_METRICS_SELECT.table);
  if (fixture === "empty") return { rides: [], weeks: [], summary: [] };
  const db = client();
  // A cycling_weeks failure stays inside its card (analyse.md §5d): carried as weeksError.
  const weeksRead = selectAll(db, CYCLING_WEEKS_SELECT.table, CYCLING_WEEKS_SELECT, parseCyclingWeekRow).catch(
    (error: unknown) => {
      console.error("analyse: loading cycling_weeks failed", error);
      if (isDataError(error)) return error;
      throw error;
    },
  );
  // The answers are secondary too (analyse.md §12d): a failure shows in place of the blocks only.
  const summaryRead = selectAll(db, ANALYSIS_SUMMARY_SELECT.table, ANALYSIS_SUMMARY_SELECT, parseAnalysisSummaryRow).catch(
    (error: unknown) => {
      console.error("analyse: loading analysis_summary failed", error);
      if (isDataError(error)) return error;
      throw error;
    },
  );
  // The FTP line (slice ftp-analyse) is decoration: unreadable = no line, never a guessed FTP.
  // Under DEV_FIXTURE ftp-warning / ftp-quiet the illustrative FTP replaces the read.
  const ftpRead =
    fixture === "ftp-warning" || fixture === "ftp-quiet"
      ? Promise.resolve(illustrativeFtp(fixture, new Date()).status)
      : selectFirst(db, FTP_STATUS_SELECT.table, FTP_STATUS_SELECT, parseFtpStatusRow).catch((error: unknown) => {
          console.error("analyse: loading ftp_status failed", error);
          if (isDataError(error)) return null;
          throw error;
        });
  // Promise.all also awaits the secondary reads when the rides read fails first (no unhandled rejection).
  const [rides, weeksResult, summaryResult, ftp] = await Promise.all([
    selectAll(db, RIDE_METRICS_SELECT.table, RIDE_METRICS_SELECT, parseRideMetricsRow),
    weeksRead,
    summaryRead,
    ftpRead,
  ]);
  const weeks = weeksResult instanceof Error ? null : weeksResult;
  const weeksError = weeksResult instanceof Error ? weeksResult : null;
  const summary = summaryResult instanceof Error ? null : summaryResult;
  const summaryError = summaryResult instanceof Error ? summaryResult : null;
  if (fixture === "stale") {
    const computedAt = staleComputedAt(new Date());
    return {
      rides: rides.map((r) => ({ ...r, computedAt })),
      weeks: weeks === null ? null : weeks.map((w) => ({ ...w, computedAt })),
      weeksError,
      summary: summary === null ? null : summary.map((a) => ({ ...a, computedAt })),
      summaryError,
      ftp,
    };
  }
  return {
    rides: fixture === "ef-few" ? fewEfPoints(rides) : rides,
    weeks,
    weeksError,
    summary: fixture === "answers" && summary !== null ? illustrativeAnswers(summary) : summary,
    summaryError,
    ftp,
  };
}

/**
 * /analyse/styrke's feel card (fokus-pause.md §7): Python's exercise_feel rows. A secondary read:
 * a failure returns null (the card shows its WarningLine), never breaks the page.
 */
export async function loadExerciseFeel(): Promise<readonly ExerciseFeelRow[] | null> {
  await connection();
  const fixture = devFixture();
  if (fixture === "feel") return ILLUSTRATIVE_FEEL;
  if (fixture === "empty") return [];
  if (fixture === "error") return null;
  try {
    return await selectAll(client(), EXERCISE_FEEL_SELECT.table, EXERCISE_FEEL_SELECT, parseExerciseFeelRow);
  } catch (error: unknown) {
    if (!isDataError(error)) throw error;
    console.error("analyse/styrke: reading exercise_feel failed", error);
    return null;
  }
}

/**
 * Fokus's catalogue read (fokus-pause.md §1.1): name, aliases and category of public.exercises,
 * to tell a main lift's warm-up from an accessory's. A secondary read: a failure returns null
 * (no main lift known, so no "Intet kg ..." line), never breaks the page.
 */
export async function loadExerciseCategories(): Promise<readonly ExerciseCategoryRow[] | null> {
  await connection();
  const fixture = devFixture();
  if (fixture === "empty") return [];
  if (fixture === "error") return null;
  try {
    return await selectAll(client(), EXERCISE_CATEGORY_SELECT.table, EXERCISE_CATEGORY_SELECT, parseExerciseCategoryRow);
  } catch (error: unknown) {
    if (!isDataError(error)) throw error;
    console.error("fokus: reading exercises failed", error);
    return null;
  }
}

/**
 * /analyse/styrke: every strength_weeks row (tiny, rebuilt whole by compute), the blocks with
 * their phase, and the tab's 1RM values (main-lift sets with an e1rm). Reads only.
 * Throws EnvError / PostgrestError / RowError; the page renders ErrorState.
 */
export async function loadStrengthAnalysis(): Promise<StrengthAnalysisData> {
  await connection();
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(STRENGTH_WEEKS_SELECT.table);
  if (fixture === "empty") return { weeks: [], blocks: [], sheetOneRm: [] };
  const db = client();
  const [weeks, blocks, sheetOneRm] = await Promise.all([
    selectAll(db, STRENGTH_WEEKS_SELECT.table, STRENGTH_WEEKS_SELECT, parseStrengthWeekRow),
    selectAll(db, STRENGTH_BLOCKS_SELECT.table, STRENGTH_BLOCKS_SELECT, parseStrengthBlockRow),
    selectAll(db, SHEET_ONE_RM_SELECT.table, SHEET_ONE_RM_SELECT, parseSheetOneRmRow),
  ]);
  if (fixture === "stale") {
    const computedAt = staleComputedAt(new Date());
    return { weeks: weeks.map((w) => ({ ...w, computedAt })), blocks, sheetOneRm };
  }
  return { weeks: fixture === "lsrpe" ? illustrativeLogged(weeks) : weeks, blocks, sheetOneRm };
}
