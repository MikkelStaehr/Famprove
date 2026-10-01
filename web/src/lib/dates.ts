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

/** ISO week number of `date`, e.g. isoWeekNumber("2026-09-30") -> 40. */
export function isoWeekNumber(date: IsoDate): number {
  const thursday = addDays(isoWeekStart(date), 3); // the ISO year is the Thursday's year
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${jan1}T00:00:00Z`)) / (7 * MS_PER_DAY)) + 1;
}
