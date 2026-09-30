/**
 * Pure display formatting (no I/O, no server-only; unit-tested with `node --test`).
 * Rounding happens here and only for display; stored values are never rounded.
 */
import type { IsoDate } from "./db/rows.ts";

export const LOCAL_TZ = "Europe/Copenhagen";
export const LOCALE = "da-DK"; // "ons. 30. sep.", "kl. 05.03", decimal comma
export const TSS_PER_DAY = "TSS/day"; // unit of CTL / ATL / TSB (DESIGN.md)

const DAY_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const UPDATED_DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  timeZone: LOCAL_TZ,
});

const UPDATED_TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, {
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
 * Calendar date, e.g. "2026-09-28" -> "man. 28. sep." (da-DK CLDR). Formats the date as-is (parse as UTC
 * midnight, format with timeZone "UTC") so no time-zone shift can move it a day.
 */
export function formatDay(date: IsoDate): string {
  return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

const DAY_LONG_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** Calendar date in words for screen readers: "2026-09-27" -> "søndag 27. september". */
export function formatDayLong(date: IsoDate): string {
  return DAY_LONG_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

/** computed_at (ISO timestamptz) in LOCAL_TZ, e.g. "28. sep. kl. 05.03". */
export function formatUpdatedAt(computedAt: string): string {
  const at = new Date(computedAt);
  return `${UPDATED_DATE_FORMAT.format(at)} kl. ${UPDATED_TIME_FORMAT.format(at)}`;
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

/** Kilograms as logged, up to 2 decimals: 120 -> "120", 22.5 -> "22,5". */
export function formatKg(kg: number): string {
  return KG_FORMAT.format(kg);
}

/**
 * The load of one set: "120 kg"; bodyweight exercises add the logged kg to "kropsvægt".
 * null when nothing was logged (logged_kg is 0 for a blank cell on a weighted exercise).
 */
export function formatSetLoad(loggedKg: number, bodyweight: boolean): string | null {
  if (!bodyweight) return loggedKg === 0 ? null : `${formatKg(loggedKg)} kg`;
  if (loggedKg === 0) return "kropsvægt";
  return loggedKg > 0
    ? `kropsvægt + ${formatKg(loggedKg)} kg`
    : `kropsvægt − ${formatKg(-loggedKg)} kg`;
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

// --- Today screen ------------------------------------------------------------------------

/**
 * Whole-number range with an en dash and no spaces: (225, 250) -> "225–250". Ends that round
 * to the same number show once: (238, 238) -> "238". For watts and % FTP (Python's numbers).
 */
export function formatRange(low: number, high: number): string {
  const a = formatLoad(low);
  const b = formatLoad(high);
  return a === b ? a : `${a}–${b}`;
}

/** A planned step's length (minutes, per repetition): 8 -> "8 min", 0.5 -> "30 s", 1.5 -> "1 min 30 s". */
export function formatStepDuration(minutes: number): string {
  const seconds = Math.round(minutes * 60);
  const whole = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (whole === 0) return `${rest} s`;
  return rest === 0 ? `${whole} min` : `${whole} min ${rest} s`;
}

/**
 * Screen-reader wording of a range between numbers: "8 - 12" -> "8 til 12", "RPE 6 - 7" ->
 * "RPE 6 til 7", "225–250" -> "225 til 250". Anything else stays as written ("-10%").
 * Visible text never uses this; it shows sheet strings exactly as written.
 */
export function spokenRange(text: string): string {
  return text.replace(/(\d)(?:\s+-\s+|–)(?=\d)/g, "$1 til ");
}

/** "1" (as written, trimmed) takes the singular word; any other value the plural. */
function counted(text: string, one: string, many: string): string {
  return `${text} ${text.trim() === "1" ? one : many}`;
}

/**
 * Visible sets × reps from the sheet cells as written: ("2", "8 - 12") -> "2 × 8 - 12".
 * With one cell missing, that one's word: "10 - 15 reps", "2 sæt". null when both are blank.
 */
export function formatSetsReps(sets: string | null, reps: string | null): string | null {
  if (sets !== null && reps !== null) return `${sets} × ${reps}`;
  if (reps !== null) return counted(reps, "rep", "reps");
  if (sets !== null) return counted(sets, "sæt", "sæt");
  return null;
}

/** Spoken sets and reps: ("1", "3") -> "1 sæt af 3 reps", ("2", "8 - 12") -> "2 sæt af 8 til 12 reps". */
export function spokenSetsReps(sets: string | null, reps: string | null): string | null {
  const spokenReps = reps === null ? null : counted(spokenRange(reps), "rep", "reps");
  if (sets !== null && spokenReps !== null) return `${counted(sets, "sæt", "sæt")} af ${spokenReps}`;
  if (spokenReps !== null) return spokenReps;
  if (sets !== null) return counted(sets, "sæt", "sæt");
  return null;
}

/** What one prescribed sheet row asks for. The sheet strings stay as written apart from ranges. */
export type ExerciseWords = {
  readonly name: string;
  readonly setsText: string | null;
  readonly repsText: string | null;
  readonly prescribed: string | null;
};

/**
 * The accessible name of a tick row, e.g. "Squat, 1 sæt af 3 reps ved RPE 5, sidste uge 100 kg".
 * `lastWeek`: undefined in week 1 (no reference line), null when nothing was logged, else the
 * formatted load ("100 kg", "kropsvægt + 10 kg").
 */
export function spokenExercise(e: ExerciseWords, lastWeek: string | null | undefined): string {
  const amount = spokenSetsReps(e.setsText, e.repsText);
  const load = e.prescribed === null ? null : spokenRange(e.prescribed);
  const what = amount !== null && load !== null ? `${amount} ved ${load}` : (amount ?? load);
  const parts = [e.name.trim()];
  if (what !== null) parts.push(what);
  if (lastWeek === null) parts.push("intet logget sidste uge");
  else if (lastWeek !== undefined) parts.push(`sidste uge ${lastWeek}`);
  return parts.join(", ");
}
