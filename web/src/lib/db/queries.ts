import "server-only";

import { connection } from "next/server";

import { devFixture, fixtureError, staleComputedAt } from "./dev-fixture.ts";
import { readSupabaseEnv } from "./env.ts";
import { createClient, selectAll, selectFirst } from "./postgrest.ts";
import { addDays, isoWeekStart } from "../dates.ts";
import {
  ACTIVITIES_SELECT,
  BLOCKS_SELECT,
  DAILY_LOAD_SELECT,
  ISO_DATE,
  parseActivityRow,
  parsePlannedTargetRow,
  parsePrescribedSetRow,
  PLANNED_TARGETS_SELECT,
  PRESCRIBED_SETS_SELECT,
  parseBlockRow,
  parseDailyLoadRow,
  parseProjectionRow,
  parseStrengthSessionRow,
  PROJECTION_SELECT,
  parseStrengthSetRow,
  parseWeeklyLoadRow,
  STRENGTH_SESSIONS_SELECT,
  STRENGTH_SETS_SELECT,
  WEEKLY_LOAD_SELECT,
} from "./rows.ts";
import type {
  DashboardData,
  DailyLoadRow,
  IsoDate,
  PlannedTargetRow,
  PrescribedSetRow,
  StrengthSessionRow,
  WeekDetailData,
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
 *
 * Throws EnvError / PostgrestError / RowError; the page catches and renders ErrorState.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  await connection();
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(DAILY_LOAD_SELECT.table);
  if (fixture === "empty") return { daily: [], blocks: [], weeks: [], projection: [] };
  const db = client();
  const [daily, blocks, weeks] = await Promise.all([
    selectAll(db, DAILY_LOAD_SELECT.table, DAILY_LOAD_SELECT, parseDailyLoadRow),
    selectAll(db, BLOCKS_SELECT.table, BLOCKS_SELECT, parseBlockRow),
    selectAll(db, WEEKLY_LOAD_SELECT.table, WEEKLY_LOAD_SELECT, parseWeeklyLoadRow),
  ]);
  // The prognose is secondary: if it can't be read, the rest of /load still renders (null).
  const projection = await selectAll(db, PROJECTION_SELECT.table, PROJECTION_SELECT, parseProjectionRow).catch(
    (error: unknown) => {
      console.error("dashboard: loading the projection failed", error);
      return null;
    },
  );
  if (fixture === "stale") {
    const computedAt = staleComputedAt(new Date());
    return { daily: daily.map((d) => ({ ...d, computedAt })), blocks, weeks, projection };
  }
  return { daily, blocks, weeks, projection };
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
  if (fixture === "empty") return { activities: [], sessions: [], sets: [] };
  const db = client();
  const [activities, sessions, sets] = await Promise.all([
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
  return { activities, sessions, sets };
}

/** Days ahead the rest state looks for the next planned ride. */
export const NEXT_SESSION_DAYS = 28;

/** The form line: the latest daily_load row on or before `today` (null when none). */
export async function loadTodayForm(today: IsoDate): Promise<DailyLoadRow | null> {
  await connection();
  if (!ISO_DATE.test(today)) throw new RangeError("loadTodayForm: invalid date");
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

/** Everything the Today screen's plan reads for one local date (form is loaded separately). */
export type TodayPlanData = {
  readonly weekStart: IsoDate; // Monday of today's ISO week
  readonly sessions: readonly StrengthSessionRow[]; // this ISO week: planned, done and extra
  readonly sets: readonly PrescribedSetRow[]; // this ISO week's prescription, every session
  readonly previousWeek: readonly PrescribedSetRow[]; // same tabs, week - 1 (references)
  readonly rides: readonly PlannedTargetRow[]; // planned rides today
  readonly upcomingRides: readonly PlannedTargetRow[]; // planned rides in (today, today + 28]
};

/**
 * This ISO week's strength sessions and prescription (the view picks session k + 1), last
 * week's sets of the same tabs, planned rides and the next ones. `today` is a local date
 * chosen by the server (never raw user input); it is validated again here. Reads only;
 * throws EnvError / PostgrestError / RowError.
 */
export async function loadTodayPlan(today: IsoDate): Promise<TodayPlanData> {
  await connection();
  if (!ISO_DATE.test(today)) throw new RangeError("loadTodayPlan: invalid date");
  const weekStart = isoWeekStart(today);
  const fixture = devFixture();
  if (fixture === "error") throw fixtureError(STRENGTH_SESSIONS_SELECT.table);
  if (fixture === "empty") {
    return { weekStart, sessions: [], sets: [], previousWeek: [], rides: [], upcomingRides: [] };
  }
  const db = client();
  const horizon = addDays(today, NEXT_SESSION_DAYS);
  const [sessions, sets, rides, upcomingRides] = await Promise.all([
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
  ]);
  // Last week's sets of the same tab(s): one query per (tab, week - 1). Tab names come from
  // this week's rows (server data) and go through URLSearchParams as eq. values.
  const previousKeys = new Map<string, { block: string; week: number }>();
  for (const s of sets) {
    if (s.week > 1) {
      previousKeys.set(`${s.block}#${s.week - 1}`, { block: s.block, week: s.week - 1 });
    }
  }
  const previous = await Promise.all(
    [...previousKeys.values()].map(({ block, week }) =>
      selectAll(
        db,
        PRESCRIBED_SETS_SELECT.table,
        { ...PRESCRIBED_SETS_SELECT, filters: [["block", `eq.${block}`], ["week", `eq.${week}`]] },
        parsePrescribedSetRow,
      ),
    ),
  );
  return { weekStart, sessions, sets, previousWeek: previous.flat(), rides, upcomingRides };
}
