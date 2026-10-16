/**
 * View model for /analyse, section Cykel (design/specs/analyse.md). Pure; unit-tested with node --test.
 * Every number is Python's (ride_metrics, cycling_weeks). Allowed here: sorting, filtering,
 * counting rows, date -> x position, choosing a y domain, and formatting. No deltas, no medians.
 */
import { eftpDot, maxLoadOf } from "./chart-marks.ts";
import { MISSING, type Readout, viCell } from "./chart-readout.ts";
import { addDays, dayNumber, isoWeek, isoWeekStart } from "./dates.ts";
import { type Freshness, freshness } from "./dashboard-view.ts";
import type { DataError } from "./data-error.ts";
import type { CyclingAnalysisData, CyclingWeekRow, FtpStatusRow, IsoDate, RideExclusion, RideMetricsRow } from "./db/rows.ts";
import { formatDate, formatDateRange, formatDay, formatDuration, formatLoad, formatWatts, LOCALE } from "./format.ts";

/** The analysis window starts here (spec §4); weeks from 2024-12-30 are clipped to it. */
export const AXIS_START: IsoDate = "2025-01-01";

/** An eFTP point: eftp_ok, so rolling_ftp_w is set (migration check). */
type EftpRow = RideMetricsRow & { readonly rollingFtpW: number };
const isEftpRow = (r: RideMetricsRow): r is EftpRow => r.eftpOk && r.rollingFtpW !== null;
/** An EF point: ef_ok, so ef is set (migration check). */
export type EfRow = RideMetricsRow & { readonly ef: number };
export const isEfRow = (r: RideMetricsRow): r is EfRow => r.efOk && r.ef !== null;
/** A ride left out of the trends (it has a reason). */
type ExcludedRow = RideMetricsRow & { readonly exclusion: RideExclusion };
const isExcluded = (r: RideMetricsRow): r is ExcludedRow => r.exclusion !== null;
const SINCE = "1. jan. 2025";
const EF_MIN_POINTS = 5;
const SEAM_MIN_WEEKS = 4;

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
  if (seconds > 0 && seconds < 60) return "under 1 min"; // never "0 min" for a real ride
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${formatDuration(seconds)} t`;
}

const KM = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const EF = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1 decimal; a real distance under 0,05 km reads "under 0,1 km", never "0,0 km". */
export const formatKm = (meters: number): string =>
  meters > 0 && meters < 50 ? "under 0,1 km" : `${KM.format(meters / 1000)} km`;
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
      return join([r.npW === null ? null : `NP ${formatWatts(r.npW)}`, time]);
    case "hr_outlier":
      return join([r.avgHr === null ? null : `puls ${formatLoad(r.avgHr)}`, time]);
    default:
      return join([time, km]);
  }
}

// --- view types ----------------------------------------------------------------------------

/** A mark in a line chart: x, y (null for an excluded mark: drawn on the bottom edge). */
export type Mark = {
  readonly x: number;
  readonly y: number | null;
  readonly trend: number | null; // EF only
  /** eFTP only: the ride's TSS (ride_metrics.load), sizing its dot; null = missing (a hollow ring). */
  readonly load: number | null;
  readonly seg: number; // line segment (a new one after every break)
  readonly latest: boolean;
  readonly excluded: boolean;
  readonly tip: readonly string[]; // tooltip lines, first = date
  readonly readout: Readout; // the chart's readout row / pointer tooltip (DESIGN.md "Charts: interaction")
};

export type LineChartView = {
  readonly marks: readonly Mark[];
  readonly segments: number;
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly sr: string;
  /** The eFTP chart's FTP level line (ftp-confirm.md §A); absent or null = none. */
  readonly level?: FtpLevel | null;
};

/** A horizontal line at the FTP set, from `x0` (ftp_since's day; null = the plot start) to today. */
export type FtpLevel = { readonly y: number; readonly x0: number | null; readonly label: string };

/** §A: the legend's FTP item, "FTP: 230 W · sat senest 21. mar. 2026"; null without an FTP. */
export function ftpCaption(ftp: FtpStatusRow | null | undefined): string | null {
  if (ftp === null || ftp === undefined || ftp.ftpW === null) return null;
  return ftp.ftpSince === null ? `FTP: ${ftp.ftpW} W` : `FTP: ${ftp.ftpW} W · sat senest ${dateWithYear(ftp.ftpSince)}`;
}

export type WeekBar = {
  readonly x0: number; // slot start (day number, clipped to the axis)
  readonly x1: number; // slot end
  readonly hours: number; // 0 for a zero week
  readonly load: number;
  readonly zero: boolean;
  readonly current: boolean;
  readonly tip: readonly string[];
  readonly readout: Readout;
  readonly srRow: readonly [string, string, string, string, string];
};

export type Seam = { readonly x0: number; readonly x1: number };
export type AxisTick = { readonly x: number; readonly label: string };

/** One excluded ride; the phone list joins `date · reason`, the desktop table puts each in its own cell. */
export type ExcludedItem = {
  readonly key: string;
  readonly date: string; // "lør. 20. sep. 2025"
  readonly reason: string; // the short Danish reason, "Udeladt" for an unknown code
  readonly explanation: string | null;
  readonly facts: string; // "" when every fact is null (dropped, never "0")
};

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
      readonly eftp: LineChartView | null; // null: fewer than 2 points
      readonly ftpCaption: string | null; // the eFTP legend's FTP item (§A); null = no FTP
      readonly noWattNote: string | null;
      readonly ef: LineChartView | EfFew;
      readonly weeks: readonly WeekBar[] | null; // null: cycling_weeks couldn't be read
      readonly weeksError: DataError | null; // why (the card's ErrorState)
      readonly weekMax: { readonly hours: number; readonly load: number };
      readonly excluded: { readonly summary: string; readonly items: readonly ExcludedItem[] } | null;
    };

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

/** Excluded ride: line 1 `… · Udeladt: For kort`, facts as the tooltip's. */
function excludedReadout(r: ExcludedRow, year: number): Readout {
  const [day, reason, ...facts] = excludedTip(r, year);
  return { head: `${day} · ${reason}`, cells: [], facts };
}

function excludedTip(r: ExcludedRow, year: number): string[] {
  const facts = exclusionFacts(r);
  return [dayText(r.date, year), `Udeladt: ${exclusionText(r.exclusion).short}`, ...(facts === "" ? [] : [facts])];
}

function eftpChart(rows: readonly RideMetricsRow[], today: IsoDate, excludedCount: number, ftp: FtpStatusRow | null = null): LineChartView | null {
  const year = yearOf(today);
  const points = rows.filter(isEftpRow);
  if (points.length < 2) return null;
  const marks: Mark[] = [];
  let seg = 0;
  const last = points[points.length - 1];
  const pauses: string[] = [];
  let prev: RideMetricsRow | null = null;
  for (const r of rows) {
    if (isExcluded(r) && exclusionText(r.exclusion).eftp) {
      marks.push({ x: dayNumber(r.date), y: null, trend: null, load: null, seg, latest: false, excluded: true, tip: excludedTip(r, year), readout: excludedReadout(r, year) });
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
      load: r.load,
      seg,
      latest: r === last,
      excluded: false,
      tip: [
        dayText(r.date, year),
        `eFTP ${formatWatts(r.rollingFtpW)}`,
        join([
          rideKind(r.type),
          r.movingS === null ? null : formatHours(r.movingS),
          r.distanceM === null ? null : formatKm(r.distanceM),
          r.npW === null ? null : `NP ${formatWatts(r.npW)}`,
        ]),
      ],
      readout: {
        head: `${dayText(r.date, year)} · ${rideKind(r.type)}`,
        cells: [
          { key: "eftp", label: "eFTP", value: formatWatts(r.rollingFtpW) },
          { key: "np", label: "NP", value: r.npW === null ? MISSING : formatWatts(r.npW) },
          viCell(r.vi, r.viWarning),
        ],
        facts: [join([r.movingS === null ? null : formatHours(r.movingS), r.distanceM === null ? null : formatKm(r.distanceM)])].filter(
          (l) => l !== "",
        ),
      },
    });
  }
  const ftpW = ftp?.ftpW ?? null;
  // §A: the y domain holds the FTP too, so its line is on the plot even above every eFTP point.
  const values = [...points.map((p) => p.rollingFtpW), ...(ftpW === null ? [] : [ftpW])];
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), 10);
  const hiRow = points.reduce((a, b) => (b.rollingFtpW > a.rollingFtpW ? b : a));
  const loRow = points.reduce((a, b) => (b.rollingFtpW < a.rollingFtpW ? b : a));
  const sr = [
    `eFTP fra intervals.icu for ${points.length} ture med watt fra ${SINCE} til ${dateWithYear(today)}.`,
    "Punkternes størrelse viser turens TSS.",
    `Seneste ${formatLoad(last.rollingFtpW)} W den ${dateWithYear(last.date)}, højeste ${formatLoad(hiRow.rollingFtpW)} W den ${dateWithYear(hiRow.date)}, laveste ${formatLoad(loRow.rollingFtpW)} W den ${dateWithYear(loRow.date)}.`,
    ...pauses,
    ...(excludedCount > 0 ? [`${rides(excludedCount)} er udeladt; se listen Udeladte ture.`] : []),
    ...(ftpW === null
      ? []
      : [ftp?.ftpSince == null ? `FTP er sat til ${ftpW} W.` : `FTP er sat til ${ftpW} W, senest sat ${dateWithYear(ftp.ftpSince)}.`]),
  ].join(" ");
  const level = ftpW === null ? null : { y: ftpW, x0: ftp?.ftpSince == null ? null : dayNumber(ftp.ftpSince), label: `FTP ${ftpW}` };
  return { marks, segments: seg + 1, domain, ticks, sr, level };
}

export type EfFew = {
  readonly kind: "few";
  readonly text: string;
  readonly list: readonly string[];
  /** The one line §12b keeps under the list ("Grafen vises fra 5 rolige ture."). */
  readonly note: string;
};

export function efTooFew(points: readonly RideMetricsRow[], currentYear: number): EfFew {
  const n = points.length;
  const text =
    n === 0
      ? `Der er ingen rolige ture med både watt og puls siden ${SINCE}. Grafen vises fra ${EF_MIN_POINTS} rolige ture.`
      : `Der er kun ${n === 1 ? "1 rolig tur" : `${n} rolige ture`} med både watt og puls siden ${SINCE}. Grafen vises fra ${EF_MIN_POINTS} rolige ture.`;
  const list = [...points]
    .reverse()
    .map((r) => `${dayText(r.date, currentYear)} · EF ${r.ef === null ? "–" : formatEf(r.ef)}`);
  return { kind: "few", text, list, note: `Grafen vises fra ${EF_MIN_POINTS} rolige ture.` };
}

/**
 * The EF trend is drawn only where at least EF_TREND_MIN_RIDES EF rides fall in its window (user,
 * 2026-10-02). A display rule counted here on purpose, the one exception to "Python owns the
 * numbers" (no migration): it only hides Python's ef_trend, never computes one. The window is
 * domain.ride_analysis's: the EF_TREND_DAYS ending on the ride's date, both ends inclusive.
 */
export const EF_TREND_MIN_RIDES = 3;
const EF_TREND_DAYS = 28;

/** EF rides in the EF_TREND_DAYS ending on this ride's date; held to Python's ef_window by
 * web/tests/fixtures/ef_window.json (python/tests/test_contract_ef_window.py). */
export function efWindowRides(r: EfRow, points: readonly EfRow[]): number {
  const end = dayNumber(r.date);
  return points.filter((q) => {
    const d = dayNumber(q.date);
    return d <= end && d > end - EF_TREND_DAYS;
  }).length;
}

/** Python's EF trend for this ride, or null when fewer than EF_TREND_MIN_RIDES EF rides back it. */
export function shownEfTrend(r: EfRow, points: readonly EfRow[]): number | null {
  if (r.efTrend === null) return null;
  return efWindowRides(r, points) >= EF_TREND_MIN_RIDES ? r.efTrend : null;
}

function efChart(rows: readonly RideMetricsRow[], today: IsoDate): LineChartView | EfFew {
  const year = yearOf(today);
  const points = rows.filter(isEfRow);
  if (points.length < EF_MIN_POINTS) return efTooFew(points, year);
  const marks: Mark[] = [];
  let seg = 0;
  let open = false; // the current segment has a trend value
  for (const r of rows) {
    if (isExcluded(r) && exclusionText(r.exclusion).ef) {
      marks.push({ x: dayNumber(r.date), y: null, trend: null, load: null, seg, latest: false, excluded: true, tip: excludedTip(r, year), readout: excludedReadout(r, year) });
      continue;
    }
    if (!isEfRow(r)) continue;
    const trend = shownEfTrend(r, points); // the dot is always drawn; the line only from 3 rides
    if ((r.efGapBefore || trend === null) && open) {
      seg += 1;
      open = false;
    }
    if (trend !== null) open = true;
    marks.push({
      x: dayNumber(r.date),
      y: r.ef,
      trend,
      load: null,
      seg,
      latest: false,
      excluded: false,
      tip: [
        dayText(r.date, year),
        `EF ${formatEf(r.ef)}`,
        ...(trend === null ? [] : [`Trend ${formatEf(trend)}`]),
        join([
          r.npW === null ? null : `NP ${formatWatts(r.npW)}`,
          r.avgHr === null ? null : `puls ${formatLoad(r.avgHr)}`,
          r.movingS === null ? null : formatHours(r.movingS),
        ]),
      ],
      readout: {
        head: dayText(r.date, year),
        cells: [
          { key: "ef", label: "EF", value: formatEf(r.ef) },
          { key: "trend", label: "Trend", value: trend === null ? MISSING : formatEf(trend) },
        ],
        facts: [
          join([
            r.npW === null ? null : `NP ${formatWatts(r.npW)}`,
            r.avgHr === null ? null : `puls ${formatLoad(r.avgHr)}`,
            r.movingS === null ? null : formatHours(r.movingS),
          ]),
        ].filter((l) => l !== ""),
      },
    });
  }
  const trends = points.flatMap((p) => {
    const t = shownEfTrend(p, points);
    return t === null ? [] : [{ date: p.date, value: t }];
  });
  const values = [...points.map((p) => p.ef), ...trends.map((t) => t.value)];
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), 0.05);
  const first = points[0];
  const last = points[points.length - 1];
  const lastTrend = trends.at(-1);
  const sr =
    `EF på ${points.length} rolige ture fra ${dateWithYear(first.date)} til ${dateWithYear(last.date)}.` +
    (lastTrend === undefined
      ? ` Seneste tur ${formatEf(last.ef)}. Trenden vises først, når der er mindst ${EF_TREND_MIN_RIDES} ture inden for 28 dage.`
      : ` Seneste trend ${formatEf(lastTrend.value)} den ${dateWithYear(lastTrend.date)}, seneste tur ${formatEf(last.ef)}.`);
  return { marks, segments: seg + 1, domain, ticks, sr };
}

// --- chart rows ----------------------------------------------------------------------------

/**
 * One Recharts row per mark, so two rides on one day keep two marks (rows may share an x on a
 * numeric axis). The line is read from one key per segment ("s0", "s1", …), set on this mark's
 * row only; `excl` places an excluded ride's hollow mark at the axis bottom; `dots` is an EF
 * ride's own value.
 */
export type ChartRow = {
  readonly x: number;
  readonly excl: number | null;
  readonly dots: number | null;
  readonly marks: readonly Mark[];
  readonly [segment: `s${number}`]: number | undefined;
};

export function chartRows(chart: LineChartView, variant: "eftp" | "ef"): ChartRow[] {
  const bottom = chart.domain[0];
  return chart.marks
    .map((m) => {
      const line = m.excluded ? null : variant === "eftp" ? m.y : m.trend;
      return {
        x: m.x,
        excl: m.excluded ? bottom : null,
        dots: variant === "ef" && !m.excluded ? m.y : null,
        marks: [m],
        ...(line === null ? {} : { [`s${m.seg}`]: line }),
      };
    })
    .sort((a, b) => a.x - b.x);
}

/**
 * eFTP dot per mark (instrument-analyse.md §2): the size scale's 100 % is the largest load of the
 * plotted (non-excluded) rides; a null load is a hollow ring (missing, not small).
 */
export function eftpDots(chart: LineChartView): readonly ({ readonly r: number; readonly hollow: boolean } | null)[] {
  const max = maxLoadOf(chart.marks.filter((m) => !m.excluded).map((m) => m.load));
  return chart.marks.map((m) => (m.excluded ? null : eftpDot(m.load, max)));
}

/** A week slot's centre (day number): where its 2px bar and the today tick sit. */
export const slotCentre = (w: { readonly x0: number; readonly x1: number }): number => (w.x0 + w.x1) / 2;

// --- weeks (spec §5d) ----------------------------------------------------------------------

export function weekBars(weeks: readonly CyclingWeekRow[], today: IsoDate, lo: number): WeekBar[] {
  const year = yearOf(today);
  const current = isoWeekStart(today);
  return weeks.map((w) => {
    const end = addDays(w.weekStart, 6);
    const isCurrent = w.weekStart === current;
    const range = formatDateRange(w.weekStart, end);
    const head = `Uge ${isoWeek(w.weekStart).week} · ${yearOf(end) === year ? range : `${range} ${yearOf(end)}`}`;
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
      readout:
        w.rides === 0
          ? { head: tip[0], cells: [], facts: ["Ingen ture"] }
          : {
              head: tip[0],
              cells: [
                { key: "hours", label: "Timer", value: formatHours(w.movingS) },
                { key: "load", label: "Belastning", value: `${formatLoad(w.load)} TSS` },
                { key: "rides", label: "Ture", value: String(w.rides) },
              ],
              facts: w.excluded > 0 ? [`${w.excluded} udeladt fra trends`] : [],
            },
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

/** DESIGN.md "Gaps": a tap inside a seam reads the seam, never a 0: "Ingen ture · 30. sep. 2025 – 10. mar. 2026". */
export function seamReadout(s: Seam): Readout {
  const day = (x: number) => new Date(Math.round(x) * 86_400_000).toISOString().slice(0, 10) as IsoDate;
  return { head: `Ingen ture · ${dateWithYear(day(s.x0 + 0.5))} – ${dateWithYear(day(s.x1 - 1.5))}`, cells: [], facts: [] };
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

/** The oldest of the tables' latest computed_at (spec §8; §12d adds analysis_summary). */
function olderComputedAt(data: CyclingAnalysisData): string | null {
  const latest = (xs: readonly { readonly computedAt: string }[]): string | null =>
    xs.reduce<string | null>((a, r) => (a === null || Date.parse(r.computedAt) > Date.parse(a) ? r.computedAt : a), null);
  const tables = [data.rides, data.weeks ?? [], data.summary ?? []]
    .map(latest)
    .filter((t): t is string => t !== null);
  return tables.reduce<string | null>((a, t) => (a === null || Date.parse(t) < Date.parse(a) ? t : a), null);
}

export function buildAnalyseView(data: CyclingAnalysisData, now: Date, today: IsoDate): AnalyseView {
  if (data.rides.length === 0) return { kind: "empty" };
  const year = yearOf(today);
  const lo = dayNumber(AXIS_START) - 0.5;
  const hi = dayNumber(today) + 0.5;
  const rows = data.rides;
  const plotted = rows.filter((r) => r.date >= AXIS_START); // the shared x domain starts 1 Jan 2025
  const excludedRows = rows.filter(isExcluded);
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
    eftp: eftpChart(plotted, today, excludedRows.length, data.ftp ?? null),
    ftpCaption: ftpCaption(data.ftp),
    noWattNote:
      noWatt === 0 ? null : `${rides(noWatt)} uden watt er ikke med her, men tæller i timer og belastning.`,
    ef: efChart(plotted, today),
    weeks,
    weeksError: data.weeksError ?? null,
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
              date: dayText(r.date, year),
              reason: exclusionText(r.exclusion).short,
              explanation: exclusionText(r.exclusion).explanation,
              facts: exclusionFacts(r),
            })),
          },
  };
}
