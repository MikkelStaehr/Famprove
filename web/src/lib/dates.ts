/**
 * Calendar-date helpers on "YYYY-MM-DD" strings (UTC arithmetic, so no time-zone shift).
 * Pure; no training math.
 */
import type { IsoDate } from "./db/rows.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar date -> whole days since the epoch (UTC, no time-zone shift); a chart x position. */
export function dayNumber(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;
}

/** `date` plus `days` calendar days, e.g. addDays("2026-10-04", 1) -> "2026-10-05". */
export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Monday of `date`'s ISO week, e.g. isoWeekStart("2026-09-30") -> "2026-09-28". */
export function isoWeekStart(date: IsoDate): IsoDate {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}

/**
 * ISO year and week of `date` (the week belongs to the year of its Thursday), e.g.
 * isoWeek("2026-09-30") -> { year: 2026, week: 40 }, isoWeek("2027-01-01") -> { year: 2026, week: 53 }.
 * The one ISO-week computation in the web; SQL views (weekly_load, weekly_plan) carry their own.
 */
export function isoWeek(date: IsoDate): { readonly year: number; readonly week: number } {
  const thursday = addDays(isoWeekStart(date), 3);
  const year = Number(thursday.slice(0, 4));
  const jan1 = Date.parse(`${year}-01-01T00:00:00Z`);
  return { year, week: Math.floor((Date.parse(`${thursday}T00:00:00Z`) - jan1) / (7 * MS_PER_DAY)) + 1 };
}
