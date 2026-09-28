import "server-only";

import { connection } from "next/server";

import { readSupabaseEnv } from "./env.ts";
import { createClient, selectAll } from "./postgrest.ts";
import {
  BLOCKS_SELECT,
  DAILY_LOAD_SELECT,
  parseBlockRow,
  parseDailyLoadRow,
  parseWeeklyLoadRow,
  WEEKLY_LOAD_SELECT,
} from "./rows.ts";
import type { DashboardData } from "./rows.ts";

/**
 * The only entry point the page calls. Reads, never writes.
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
  const env = readSupabaseEnv();
  const client = createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
  const [daily, blocks, weeks] = await Promise.all([
    selectAll(client, DAILY_LOAD_SELECT.table, DAILY_LOAD_SELECT, parseDailyLoadRow),
    selectAll(client, BLOCKS_SELECT.table, BLOCKS_SELECT, parseBlockRow),
    selectAll(client, WEEKLY_LOAD_SELECT.table, WEEKLY_LOAD_SELECT, parseWeeklyLoadRow),
  ]);
  return { daily, blocks, weeks };
}
