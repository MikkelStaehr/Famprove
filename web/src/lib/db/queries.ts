import "server-only";

import { connection } from "next/server";

import { readSupabaseEnv } from "./env.ts";
import { createClient, selectAll } from "./postgrest.ts";
import { addDays } from "../dates.ts";
import {
  ACTIVITIES_SELECT,
  BLOCKS_SELECT,
  DAILY_LOAD_SELECT,
  parseActivityRow,
  parseBlockRow,
  parseDailyLoadRow,
  parseStrengthSetRow,
  parseWeeklyLoadRow,
  STRENGTH_SETS_SELECT,
  WEEKLY_LOAD_SELECT,
} from "./rows.ts";
import type { DashboardData, IsoDate, WeekDetailData } from "./rows.ts";

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
  const db = client();
  const [daily, blocks, weeks] = await Promise.all([
    selectAll(db, DAILY_LOAD_SELECT.table, DAILY_LOAD_SELECT, parseDailyLoadRow),
    selectAll(db, BLOCKS_SELECT.table, BLOCKS_SELECT, parseBlockRow),
    selectAll(db, WEEKLY_LOAD_SELECT.table, WEEKLY_LOAD_SELECT, parseWeeklyLoadRow),
  ]);
  return { daily, blocks, weeks };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rides and strength sets dated inside [start, end] (a weekly_load row's week, never raw
 * user input). Reads only. Throws EnvError / PostgrestError / RowError like loadDashboardData.
 */
export async function loadWeekDetail(start: IsoDate, end: IsoDate): Promise<WeekDetailData> {
  await connection();
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || end < start) {
    throw new RangeError("loadWeekDetail: invalid week range");
  }
  const db = client();
  const [activities, sets] = await Promise.all([
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
      STRENGTH_SETS_SELECT.table,
      { ...STRENGTH_SETS_SELECT, filters: [["date", `gte.${start}`], ["date", `lte.${end}`]] },
      parseStrengthSetRow,
    ),
  ]);
  return { activities, sets };
}
