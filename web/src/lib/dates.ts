/**
 * Calendar-date helpers on "YYYY-MM-DD" strings (UTC arithmetic, so no time-zone shift).
 * Pure; no training math.
 */
import type { IsoDate } from "./db/rows.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `date` plus `days` calendar days, e.g. addDays("2026-10-04", 1) -> "2026-10-05". */
export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}
