/**
 * Pure view-model: DashboardData (+ the clock) -> what the page renders. No I/O, no
 * server-only, no React; unit-tested with `node --test`.
 *
 * It SELECTS and SHAPES Python's numbers; it never calculates training metrics (CTL, ATL,
 * TSB, ramp and zone all come from daily_load). The clock is used for one thing only:
 * staleness of computed_at. "Today" / "this week" = the latest daily_load row's date.
 */
import type { BlockRow, DailyLoadRow, DashboardData, IsoDate } from "./db/rows.ts";

export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

export type Tone = "neutral" | "positive" | "warning" | "negative";

export type Freshness =
  | { readonly kind: "fresh"; readonly computedAt: string }
  | { readonly kind: "stale"; readonly computedAt: string }
  | { readonly kind: "unknown" }; // computed_at null (pre-M2 compute): render as stale

export type Hero = {
  readonly date: IsoDate; // latest daily_load date
  readonly tsb: number;
  readonly ctl: number;
  readonly atl: number;
  readonly ctlRamp7d: number | null;
  readonly zone: { readonly key: string; readonly label: string; readonly tone: Tone } | null;
};

export type ChartPoint = {
  readonly date: IsoDate;
  readonly ctl: number;
  readonly atl: number;
  readonly tsb: number;
};

export type BlockSpan = {
  readonly name: string;
  readonly start: IsoDate;
  readonly end: IsoDate; // clipped to the series end; an ongoing block runs to it
  readonly deloadStart: IsoDate | null; // deload shading = [deloadStart, end]
  readonly ongoing: boolean; // deload_start is null
};

export type WeekDay = {
  readonly date: IsoDate;
  readonly cyclingTss: number;
  readonly strengthTss: number;
  readonly totalTss: number;
};

export type WeekView = {
  readonly weekStart: IsoDate;
  readonly weekEnd: IsoDate;
  readonly isoYear: number;
  readonly isoWeek: number;
  readonly cyclingTss: number; // from weekly_load (SQL owns the ISO-week SUM)
  readonly strengthTss: number;
  readonly totalTss: number;
  readonly days: readonly WeekDay[]; // daily_load rows inside the week, ascending
};

export type DashboardView =
  | { readonly kind: "empty" } // no daily_load rows
  | {
      readonly kind: "ready";
      readonly hero: Hero;
      readonly freshness: Freshness;
      readonly chart: readonly ChartPoint[];
      readonly blocks: readonly BlockSpan[];
      readonly week: WeekView | null; // null if weekly_load has no row for the latest date
    };

/**
 * Display text + tone per Python FormZone key (python/src/training_load/domain/form.py,
 * intervals.icu's zone names). Presentation only; thresholds live in Python.
 * Unknown keys -> raw key, "neutral".
 */
export const FORM_ZONE_DISPLAY: Readonly<Record<string, { label: string; tone: Tone }>> = {
  transition: { label: "Transition", tone: "warning" },
  fresh: { label: "Fresh", tone: "positive" },
  grey_zone: { label: "Grey zone", tone: "neutral" },
  optimal: { label: "Optimal training", tone: "positive" },
  high_risk: { label: "High risk", tone: "negative" },
};

export function zoneDisplay(key: string | null): Hero["zone"] {
  if (key === null) return null;
  const display = Object.hasOwn(FORM_ZONE_DISPLAY, key) ? FORM_ZONE_DISPLAY[key] : undefined;
  return { key, label: display?.label ?? key, tone: display?.tone ?? "neutral" };
}

/** "fresh" when now - computedAt <= STALE_AFTER_MS, else "stale"; null -> "unknown". */
export function freshness(computedAt: string | null, now: Date): Freshness {
  if (computedAt === null) return { kind: "unknown" };
  const at = Date.parse(computedAt);
  if (Number.isNaN(at)) return { kind: "unknown" };
  return now.getTime() - at <= STALE_AFTER_MS
    ? { kind: "fresh", computedAt }
    : { kind: "stale", computedAt };
}

/**
 * One span per block with startDate <= seriesEnd, ascending. end = seriesEnd when ongoing
 * (deloadStart null) or endDate null, else min(endDate, seriesEnd). ISO dates compare as strings.
 */
export function blockSpans(blocks: readonly BlockRow[], seriesEnd: IsoDate): BlockSpan[] {
  return blocks
    .filter((b) => b.startDate <= seriesEnd)
    .toSorted((a, b) => a.startDate.localeCompare(b.startDate))
    .map((b) => {
      const ongoing = b.deloadStart === null;
      const end =
        ongoing || b.endDate === null || b.endDate > seriesEnd ? seriesEnd : b.endDate;
      const deloadStart = b.deloadStart !== null && b.deloadStart <= end ? b.deloadStart : null;
      return { name: b.name, start: b.startDate, end, deloadStart, ongoing };
    });
}

/**
 * The weekly_load row with weekStart <= latest <= weekEnd, plus the daily rows in that range.
 * Null when there is none.
 */
export function currentWeek(data: DashboardData, latest: IsoDate): WeekView | null {
  const week = data.weeks.find((w) => w.weekStart <= latest && latest <= w.weekEnd);
  if (week === undefined) return null;
  const days = data.daily
    .filter((d) => week.weekStart <= d.date && d.date <= week.weekEnd)
    .map((d) => ({
      date: d.date,
      cyclingTss: d.cyclingTss,
      strengthTss: d.strengthTss,
      totalTss: d.totalTss,
    }));
  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
    cyclingTss: week.cyclingTss,
    strengthTss: week.strengthTss,
    totalTss: week.totalTss,
    days,
  };
}

/** Hero from the latest row (last element of data.daily). */
export function hero(latest: DailyLoadRow): Hero {
  return {
    date: latest.date,
    tsb: latest.tsb,
    ctl: latest.ctl,
    atl: latest.atl,
    ctlRamp7d: latest.ctlRamp7d,
    zone: zoneDisplay(latest.formZone),
  };
}

/** Composes the helpers above. "empty" when data.daily is empty. */
export function buildDashboardView(data: DashboardData, now: Date): DashboardView {
  const latest = data.daily.at(-1);
  if (latest === undefined) return { kind: "empty" };
  return {
    kind: "ready",
    hero: hero(latest),
    freshness: freshness(latest.computedAt, now),
    chart: data.daily.map((d) => ({ date: d.date, ctl: d.ctl, atl: d.atl, tsb: d.tsb })),
    blocks: blockSpans(data.blocks, latest.date),
    week: currentWeek(data, latest.date),
  };
}
