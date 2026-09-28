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

const KG_FORMAT = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

/** Seconds as h:mm, rounded to the minute: 3720 -> "1:02", 2700 -> "0:45". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Intensity factor from intervals.icu's percent, as a fraction with 2 decimals: 85.3 -> "0.85". */
export function formatIf(percent: number): string {
  return (Math.round(percent) / 100).toFixed(2);
}

/** Power in whole watts with its unit: 249.6 -> "250 W". */
export function formatWatts(watts: number): string {
  return `${formatLoad(watts)} W`;
}

/** Kilograms as logged, up to 2 decimals: 120 -> "120", 22.5 -> "22.5". */
export function formatKg(kg: number): string {
  return KG_FORMAT.format(kg);
}

/**
 * The load of one set: "120 kg"; bodyweight exercises add the logged kg to "bodyweight".
 * null when nothing was logged (logged_kg is 0 for a blank cell on a weighted exercise).
 */
export function formatSetLoad(loggedKg: number, bodyweight: boolean): string | null {
  if (!bodyweight) return loggedKg === 0 ? null : `${formatKg(loggedKg)} kg`;
  if (loggedKg === 0) return "bodyweight";
  return loggedKg > 0
    ? `bodyweight + ${formatKg(loggedKg)} kg`
    : `bodyweight − ${formatKg(-loggedKg)} kg`;
}

/** A raw strength score as a whole number: 336.8 -> "337". */
export function formatScore(score: number): string {
  return formatLoad(score);
}

/** intervals.icu upper-cases the maker in device_name; show it as the maker writes it. */
const DEVICE_MAKERS: Readonly<Record<string, string>> = {
  HAMMERHEAD: "Hammerhead",
  WAHOO_FITNESS: "Wahoo",
  WAHOO: "Wahoo",
  GARMIN: "Garmin",
  ZWIFT: "Zwift",
};

/** "HAMMERHEAD Karoo" -> "Hammerhead Karoo", "WAHOO_FITNESS ELEMNT BOLT" -> "Wahoo ELEMNT BOLT". */
export function formatDevice(device: string | null): string {
  const words = (device ?? "").trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "Unknown device";
  const [maker, ...model] = words;
  const shown = Object.hasOwn(DEVICE_MAKERS, maker) ? DEVICE_MAKERS[maker] : maker.replaceAll("_", " ");
  return [shown, ...model].join(" ");
}

const WEEK_PARAM = /^(\d{4})-W(\d{2})$/;

/** A `?week=` value in words: "2026-W09" -> "week 9"; the year only when it isn't `year`. */
export function formatWeekParam(param: string, year: number): string {
  const match = WEEK_PARAM.exec(param);
  if (match === null) return param;
  const week = `week ${Number(match[2])}`;
  return Number(match[1]) === year ? week : `${week}, ${match[1]}`;
}
