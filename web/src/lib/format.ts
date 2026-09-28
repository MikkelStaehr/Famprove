/**
 * Pure display formatting (no I/O, no server-only; unit-tested with `node --test`).
 * Rounding happens here and only for display; stored values are never rounded.
 */
import type { IsoDate } from "./db/rows.ts";

export const LOCAL_TZ = "Europe/Copenhagen";
export const LOCALE = "en-GB"; // 24 h clock, day-month order
export const TSS_PER_DAY = "TSS/day"; // unit of CTL / ATL / TSB (DESIGN.md)

const DAY_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const UPDATED_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: LOCAL_TZ,
});

/** Whole TSS, e.g. 72.4 -> "72". Never "-0". */
export function formatLoad(value: number): string {
  const rounded = Math.round(value);
  return String(rounded === 0 ? 0 : rounded);
}

/** Signed whole number with a real minus sign: 5.2 -> "+5", -12.6 -> "−13", -0.3 -> "0". */
export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return "0";
}

/**
 * Calendar date, e.g. "2026-09-28" -> "Mon 28 Sept" (en-GB CLDR). Formats the date as-is (parse as UTC
 * midnight, format with timeZone "UTC") so no time-zone shift can move it a day.
 */
export function formatDay(date: IsoDate): string {
  return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

/** computed_at (ISO timestamptz) in LOCAL_TZ, e.g. "28 Sept, 05:03". */
export function formatUpdatedAt(computedAt: string): string {
  return UPDATED_FORMAT.format(new Date(computedAt));
}
