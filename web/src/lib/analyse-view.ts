/**
 * View model for /analyse, section Cykel (design/specs/analyse.md). Pure; unit-tested with node --test.
 * Every number is Python's (ride_metrics, cycling_weeks). Allowed here: sorting, filtering,
 * counting rows, date -> x position, choosing a y domain, and formatting. No deltas, no medians.
 */
import { addDays, isoWeekNumber, isoWeekStart } from "./dates.ts";
import { type Freshness, freshness } from "./dashboard-view.ts";
import type { CyclingAnalysisData, CyclingWeekRow, IsoDate, RideMetricsRow } from "./db/rows.ts";
import { formatDate, formatDateRange, formatDay, formatDayLong, formatDuration, formatLoad, formatSigned, LOCALE } from "./format.ts";

/** The analysis window starts here (spec §4); weeks from 2024-12-30 are clipped to it. */
export const AXIS_START: IsoDate = "2025-01-01";
const SINCE = "1. jan. 2025";
const DAY_MS = 86_400_000;
const EF_MIN_POINTS = 5;
const SEAM_MIN_WEEKS = 4;

/** Calendar date -> whole days since the epoch (UTC, no time-zone shift). */
export function dayNumber(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

// --- formatting ----------------------------------------------------------------------------

const yearOf = (date: IsoDate): number => Number(date.slice(0, 4));

/** "tirs. 3. jun." in the current year, "tirs. 3. jun. 2025" outside it (spec, top). */
export function dayText(date: IsoDate, currentYear: number): string {
  const y = yearOf(date);
  return y === currentYear ? formatDay(date) : `${formatDay(date)} ${y}`;
}

/** "3. jun. 2025" for screen-reader sentences (year always: the window spans two years). */
function dateWithYear(date: IsoDate): string {
  return `${formatDate(date)} ${yearOf(date)}`;
}

/** h:mm t; under 1 h, "45 min" (spec §6). */
export function formatHours(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${formatDuration(seconds)} t`;
}

const KM = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const EF = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatKm = (meters: number): string => `${KM.format(meters / 1000)} km`;
export const formatEf = (ef: number): string => EF.format(ef);
const rides = (n: number): string => (n === 1 ? "1 tur" : `${n} ture`);
const join = (parts: readonly (string | null)[]): string => parts.filter((p) => p !== null).join(" · ");

// --- exclusions (spec §5a) -----------------------------------------------------------------

export type ExclusionText = {
  readonly short: string;
  readonly explanation: string | null; // null: unknown code, never a guessed reason
  readonly eftp: boolean; // drawn in the eFTP chart
  readonly ef: boolean; // drawn in the EF chart
};

export const EXCLUSIONS: Readonly<Record<string, ExclusionText>> = {
  too_short: { short: "For kort", explanation: "Under 5 min eller 1 km. Ikke med i eFTP og EF.", eftp: true, ef: true },
  power_outlier: {
    short: "Usandsynlige watt",
    explanation: "Watt-målingen ser forkert ud. Ikke med i eFTP og EF.",
    eftp: true,
    ef: true,
  },
  hr_outlier: {
    short: "Usandsynlig puls",
    explanation: "Gennemsnitspulsen er under 80 eller over 200. Ikke med i EF.",
    eftp: false,
    ef: true,
  },
  no_raw: {
    short: "Ikke hentet endnu",
    explanation: "Turens detaljer er ikke hentet endnu. Det daglige job henter dem.",
    eftp: true,
    ef: true,
  },
};

export function exclusionText(code: string): ExclusionText {
  return Object.hasOwn(EXCLUSIONS, code)
    ? EXCLUSIONS[code]
    : { short: "Udeladt", explanation: null, eftp: true, ef: true };
}

/** The facts an exclusion is about; a null value drops its fact (never "0"). */
export function exclusionFacts(r: RideMetricsRow): string {
  const time = r.movingS === null ? null : formatHours(r.movingS);
  const km = r.distanceM === null ? null : formatKm(r.distanceM);
  switch (r.exclusion) {
    case "power_outlier":
      return join([r.npW === null ? null : `NP ${formatLoad(r.npW)} W`, time]);
    case "hr_outlier":
      return join([r.avgHr === null ? null : `puls ${formatLoad(r.avgHr)}`, time]);
    default:
      return join([time, km]);
  }
}

// --- view types ----------------------------------------------------------------------------

export type Direction = "up" | "down" | "flat";

export type HeroView =
  | { readonly kind: "none"; readonly text: string; readonly sr: string }
  | {
      readonly kind: "eftp";
      readonly value: string; // "184 W"
      readonly dateText: string; // "fra tirs. 15. sep."
      readonly delta: { readonly direction: Direction | null; readonly text: string };
      readonly detail: string | null;
      readonly sr: string;
    };

/** A mark in a line chart: x, y (null for an excluded mark: drawn on the bottom edge). */
export type Mark = {
  readonly x: number;
  readonly y: number | null;
  readonly trend: number | null; // EF only
  readonly seg: number; // line segment (a new one after every break)
  readonly latest: boolean;
  readonly excluded: boolean;
  readonly tip: readonly string[]; // tooltip lines, first = date
};

export type LineChartView = {
  readonly marks: readonly Mark[];
  readonly segments: number;
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly sr: string;
};

export type WeekBar = {
  readonly x0: number; // slot start (day number, clipped to the axis)
  readonly x1: number; // slot end
  readonly hours: number; // 0 for a zero week
  readonly load: number;
  readonly zero: boolean;
  readonly current: boolean;
  readonly tip: readonly string[];
  readonly srRow: readonly [string, string, string, string, string];
};

export type Seam = { readonly x0: number; readonly x1: number };
export type AxisTick = { readonly x: number; readonly label: string };

export type ExcludedItem = { readonly key: string; readonly title: string; readonly explanation: string | null; readonly facts: string };

export type AnalyseView =
  | { readonly kind: "empty" }
  | {
      readonly kind: "ready";
      readonly freshness: Freshness;
      readonly lo: number;
      readonly hi: number;
      readonly ticksNarrow: readonly AxisTick[];
      readonly ticksWide: readonly AxisTick[];
      readonly seams: readonly Seam[];
      readonly hero: HeroView;
      readonly eftp: LineChartView | null; // null: fewer than 2 points
      readonly noWattNote: string | null;
      readonly ef: LineChartView | { readonly kind: "few"; readonly text: string; readonly list: readonly string[] };
      readonly weeks: readonly WeekBar[] | null; // null: cycling_weeks couldn't be read
      readonly weekMax: { readonly hours: number; readonly load: number };
      readonly excluded: { readonly summary: string; readonly items: readonly ExcludedItem[] } | null;
    };

// --- hero (spec §3, §6, §9) ----------------------------------------------------------------

export function deltaCopy(deltaW: number | null): { readonly direction: Direction | null; readonly text: string } {
  if (deltaW === null) return { direction: null, text: "Ingen eFTP fra samme tid sidste år at sammenligne med" };
  const signed = formatSigned(deltaW);
  if (signed.startsWith("+")) return { direction: "up", text: `eFTP stiger: ${signed} W på et år` };
  if (signed.startsWith("−")) return { direction: "down", text: `eFTP falder: ${signed} W på et år` };
  return { direction: "flat", text: "eFTP uændret på et år" };
}

/** The hero is the latest eftp_ok row (selection); its delta is passed through as delivered. */
export function buildHero(rows: readonly RideMetricsRow[], currentYear: number): HeroView {
  const latest = rows.findLast((r) => r.eftpOk && r.rollingFtpW !== null);
  if (latest === undefined || latest.rollingFtpW === null) {
    const text = `Ingen ture med watt siden ${SINCE}, så der er ingen eFTP endnu.`;
    return { kind: "none", text, sr: text };
  }
  const w = formatLoad(latest.rollingFtpW);
  const compare = latest.eftpYearAgoW !== null && latest.eftpYearAgoDate !== null;
  const detail = compare
    ? `Samme tid sidste år: ${formatLoad(latest.eftpYearAgoW ?? 0)} W (${dayText(latest.eftpYearAgoDate ?? "", currentYear)})`
    : null;
  let sr = `Estimeret FTP ${w} watt den ${formatDayLong(latest.date)}.`;
  if (compare && latest.eftpDeltaW !== null) {
    const d = formatSigned(latest.eftpDeltaW);
    const spoken = d.startsWith("+") ? `plus ${d.slice(1)} watt` : d.startsWith("−") ? `minus ${d.slice(1)} watt` : "uændret";
    sr += ` Et år før: ${formatLoad(latest.eftpYearAgoW ?? 0)} watt, ${spoken}.`;
  }
  return {
    kind: "eftp",
    value: `${w} W`,
    dateText: `fra ${dayText(latest.date, currentYear)}`,
    delta: deltaCopy(latest.eftpDeltaW),
    detail,
    sr,
  };
}

// --- y domains (choosing a domain is allowed, spec intro) -----------------------------------

function niceTicks(lo: number, hi: number, unit: number): { domain: [number, number]; ticks: number[] } {
  let min = Math.floor(lo / unit) * unit;
  let max = Math.ceil(hi / unit) * unit;
  if (max === min) {
    min -= unit;
    max += unit;
  }
  const steps = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((s) => s * unit);
  const step = steps.find((s) => (max - min) / s <= 3) ?? steps[steps.length - 1];
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 1000; t += step) ticks.push(Math.round(t / unit) * unit);
  return { domain: [min, max], ticks };
}

// --- charts --------------------------------------------------------------------------------

function rideKind(type: string): string {
  return type === "VirtualRide" ? "Virtuel tur" : "Udendørs tur";
}

function excludedTip(r: RideMetricsRow, year: number): string[] {
  const facts = exclusionFacts(r);
  return [dayText(r.date, year), `Udeladt: ${exclusionText(r.exclusion ?? "").short}`, ...(facts === "" ? [] : [facts])];
}

function eftpChart(rows: readonly RideMetricsRow[], today: IsoDate, excludedCount: number): LineChartView | null {
  const year = yearOf(today);
  const points = rows.filter((r) => r.eftpOk && r.rollingFtpW !== null);
  if (points.length < 2) return null;
  const marks: Mark[] = [];
  let seg = 0;
  const last = points[points.length - 1];
  const pauses: string[] = [];
  let prev: RideMetricsRow | null = null;
  for (const r of rows) {
    if (r.exclusion !== null && exclusionText(r.exclusion).eftp) {
      marks.push({ x: dayNumber(r.date), y: null, trend: null, seg, latest: false, excluded: true, tip: excludedTip(r, year) });
      continue;
    }
    if (!r.eftpOk || r.rollingFtpW === null) continue;
    if (r.eftpGapBefore && prev !== null) {
      seg += 1;
      pauses.push(`Pause uden punkter fra ${dateWithYear(prev.date)} til ${dateWithYear(r.date)}.`);
    }
    prev = r;
    marks.push({
      x: dayNumber(r.date),
      y: r.rollingFtpW,
      trend: null,
      seg,
      latest: r === last,
      excluded: false,
      tip: [
        dayText(r.date, year),
        `eFTP ${formatLoad(r.rollingFtpW)} W`,
        join([
          rideKind(r.type),
          r.movingS === null ? null : formatHours(r.movingS),
          r.distanceM === null ? null : formatKm(r.distanceM),
          r.npW === null ? null : `NP ${formatLoad(r.npW)} W`,
        ]),
      ],
    });
  }
  const values = points.map((p) => p.rollingFtpW ?? 0);
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), 10);
  const hiRow = points.reduce((a, b) => ((b.rollingFtpW ?? 0) > (a.rollingFtpW ?? 0) ? b : a));
  const loRow = points.reduce((a, b) => ((b.rollingFtpW ?? 0) < (a.rollingFtpW ?? 0) ? b : a));
  const sr = [
    `eFTP fra intervals.icu for ${points.length} ture med watt fra ${SINCE} til ${dateWithYear(today)}.`,
    `Seneste ${formatLoad(last.rollingFtpW ?? 0)} W den ${dateWithYear(last.date)}, højeste ${formatLoad(hiRow.rollingFtpW ?? 0)} W den ${dateWithYear(hiRow.date)}, laveste ${formatLoad(loRow.rollingFtpW ?? 0)} W den ${dateWithYear(loRow.date)}.`,
    ...pauses,
    ...(excludedCount > 0 ? [`${rides(excludedCount)} er udeladt; se listen Udeladte ture.`] : []),
  ].join(" ");
  return { marks, segments: seg + 1, domain, ticks, sr };
}

export type EfFew = { readonly kind: "few"; readonly text: string; readonly list: readonly string[] };

export function efTooFew(points: readonly RideMetricsRow[], currentYear: number): EfFew {
  const n = points.length;
  const text =
    n === 0
      ? `Der er ingen rolige ture med både watt og puls siden ${SINCE}. Trenden vises, når der er mindst 5.`
      : `Der er kun ${n === 1 ? "1 rolig tur" : `${n} rolige ture`} med både watt og puls siden ${SINCE}. Trenden vises fra 5.`;
  const list = [...points]
    .reverse()
    .map((r) => `${dayText(r.date, currentYear)} · EF ${r.ef === null ? "–" : formatEf(r.ef)}`);
  return { kind: "few", text, list };
}

function efChart(rows: readonly RideMetricsRow[], today: IsoDate): LineChartView | EfFew {
  const year = yearOf(today);
  const points = rows.filter((r) => r.efOk && r.ef !== null);
  if (points.length < EF_MIN_POINTS) return efTooFew(points, year);
  const marks: Mark[] = [];
  let seg = 0;
  let open = false; // the current segment has a trend value
  for (const r of rows) {
    if (r.exclusion !== null && exclusionText(r.exclusion).ef) {
      marks.push({ x: dayNumber(r.date), y: null, trend: null, seg, latest: false, excluded: true, tip: excludedTip(r, year) });
      continue;
    }
    if (!r.efOk || r.ef === null) continue;
    if ((r.efGapBefore || r.efTrend === null) && open) {
      seg += 1;
      open = false;
    }
    if (r.efTrend !== null) open = true;
    marks.push({
      x: dayNumber(r.date),
      y: r.ef,
      trend: r.efTrend,
      seg,
      latest: false,
      excluded: false,
      tip: [
        dayText(r.date, year),
        `EF ${formatEf(r.ef)}`,
        ...(r.efTrend === null ? [] : [`Trend ${formatEf(r.efTrend)}`]),
        join([
          r.npW === null ? null : `NP ${formatLoad(r.npW)} W`,
          r.avgHr === null ? null : `puls ${formatLoad(r.avgHr)}`,
          r.movingS === null ? null : formatHours(r.movingS),
        ]),
      ],
    });
  }
  const values = points.flatMap((p) => [p.ef ?? 0, ...(p.efTrend === null ? [] : [p.efTrend])]);
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), 0.05);
  const first = points[0];
  const last = points[points.length - 1];
  const lastTrend = points.findLast((p) => p.efTrend !== null);
  const sr =
    `EF på ${points.length} rolige ture fra ${dateWithYear(first.date)} til ${dateWithYear(last.date)}.` +
    (lastTrend === undefined
      ? ` Seneste tur ${formatEf(last.ef ?? 0)}.`
      : ` Seneste trend ${formatEf(lastTrend.efTrend ?? 0)} den ${dateWithYear(lastTrend.date)}, seneste tur ${formatEf(last.ef ?? 0)}.`);
  return { marks, segments: seg + 1, domain, ticks, sr };
}

// --- weeks (spec §5d) ----------------------------------------------------------------------

export function weekBars(weeks: readonly CyclingWeekRow[], today: IsoDate, lo: number): WeekBar[] {
  const year = yearOf(today);
  const current = isoWeekStart(today);
  return weeks.map((w) => {
    const end = addDays(w.weekStart, 6);
    const isCurrent = w.weekStart === current;
    const range = formatDateRange(w.weekStart, end);
    const head = `Uge ${isoWeekNumber(w.weekStart)} · ${yearOf(end) === year ? range : `${range} ${yearOf(end)}`}`;
    const tip =
      w.rides === 0
        ? [isCurrent ? `${head} · indtil videre` : head, "Ingen ture"]
        : [
            isCurrent ? `${head} · indtil videre` : head,
            `${rides(w.rides)} · ${formatHours(w.movingS)} · ${formatLoad(w.load)} TSS`,
            ...(w.excluded > 0 ? [`${w.excluded} udeladt fra trends`] : []),
          ];
    return {
      x0: Math.max(dayNumber(w.weekStart) - 0.5, lo),
      x1: dayNumber(w.weekStart) + 6.5,
      hours: w.movingS / 3600,
      load: w.load,
      zero: w.rides === 0,
      current: isCurrent,
      tip,
      srRow: [
        head,
        String(w.rides),
        w.rides === 0 ? "0" : formatHours(w.movingS),
        formatLoad(w.load),
        String(w.excluded),
      ],
    };
  });
}

/** Runs of >= 4 consecutive cycling_weeks rows with rides = 0 (spec §4): from its first Monday to the Monday after. */
export function seams(weeks: readonly CyclingWeekRow[]): Seam[] {
  const out: Seam[] = [];
  let start = -1;
  for (let i = 0; i <= weeks.length; i += 1) {
    const zero = i < weeks.length && weeks[i].rides === 0;
    if (zero && start < 0) start = i;
    if (!zero && start >= 0) {
      if (i - start >= SEAM_MIN_WEEKS) {
        out.push({ x0: dayNumber(weeks[start].weekStart) - 0.5, x1: dayNumber(addDays(weeks[i - 1].weekStart, 7)) - 0.5 });
      }
      start = -1;
    }
  }
  return out;
}

// --- axis (spec §4) ------------------------------------------------------------------------

const MONTH = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" });

export function axisTicks(today: IsoDate, wide: boolean): AxisTick[] {
  const months = wide ? [0, 3, 6, 9] : [0, 6];
  const out: AxisTick[] = [];
  for (let y = yearOf(AXIS_START); y <= yearOf(today); y += 1) {
    for (const m of months) {
      const date = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      if (date < AXIS_START || date > today) continue;
      const month = MONTH.format(new Date(`${date}T00:00:00Z`));
      out.push({ x: dayNumber(date), label: m === 0 ? `${month} ${y}` : month });
    }
  }
  return out;
}

// --- page ----------------------------------------------------------------------------------

/** The older of the two tables' latest computed_at (spec §8). */
function olderComputedAt(data: CyclingAnalysisData): string | null {
  const latest = (xs: readonly { readonly computedAt: string }[]): string | null =>
    xs.reduce<string | null>((a, r) => (a === null || Date.parse(r.computedAt) > Date.parse(a) ? r.computedAt : a), null);
  const rides = latest(data.rides);
  const weeks = data.weeks === null ? null : latest(data.weeks);
  if (rides === null || weeks === null) return rides ?? weeks;
  return Date.parse(rides) < Date.parse(weeks) ? rides : weeks;
}

export function buildAnalyseView(data: CyclingAnalysisData, now: Date, today: IsoDate): AnalyseView {
  if (data.rides.length === 0) return { kind: "empty" };
  const year = yearOf(today);
  const lo = dayNumber(AXIS_START) - 0.5;
  const hi = dayNumber(today) + 0.5;
  const rows = data.rides;
  const plotted = rows.filter((r) => r.date >= AXIS_START); // the shared x domain starts 1 Jan 2025
  const excludedRows = rows.filter((r) => r.exclusion !== null);
  const noWatt = rows.filter((r) => r.exclusion === null && !r.eftpOk).length;
  const weeks = data.weeks === null ? null : weekBars(data.weeks, today, lo);
  return {
    kind: "ready",
    freshness: freshness(olderComputedAt(data), now),
    lo,
    hi,
    ticksNarrow: axisTicks(today, false),
    ticksWide: axisTicks(today, true),
    seams: data.weeks === null ? [] : seams(data.weeks),
    hero: buildHero(rows, year),
    eftp: eftpChart(plotted, today, excludedRows.length),
    noWattNote:
      noWatt === 0 ? null : `${rides(noWatt)} uden watt er ikke med her, men tæller i timer og belastning.`,
    ef: efChart(plotted, today),
    weeks,
    weekMax: {
      hours: Math.max(0, ...(weeks ?? []).map((w) => w.hours)),
      load: Math.max(0, ...(weeks ?? []).map((w) => w.load)),
    },
    excluded:
      excludedRows.length === 0
        ? null
        : {
            summary: `${rides(excludedRows.length)} udeladt fra trends`,
            items: [...excludedRows].reverse().map((r) => ({
              key: r.activityId,
              title: `${dayText(r.date, year)} · ${exclusionText(r.exclusion ?? "").short}`,
              explanation: exclusionText(r.exclusion ?? "").explanation,
              facts: exclusionFacts(r),
            })),
          },
  };
}
