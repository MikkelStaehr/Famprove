/**
 * Pure view-model: DashboardData (+ the clock) -> what the page renders. No I/O, no
 * server-only, no React; unit-tested with `node --test`.
 *
 * It SELECTS and SHAPES Python's numbers; it never calculates training metrics (CTL, ATL,
 * TSB, ramp and zone all come from daily_load). The clock is used for one thing only:
 * staleness of computed_at. "Today" / "this week" = the latest daily_load row's date.
 * The week switcher picks among weekly_load rows; a `?week=` value that names no row falls
 * back to the latest week, so user input never reaches a query.
 */
import type {
  ActivityRow,
  BlockRow,
  DailyLoadRow,
  DashboardData,
  IsoDate,
  StrengthSetRow,
  WeekDetailData,
  WeeklyLoadRow,
} from "./db/rows.ts";

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
  readonly blockNo: number; // blocks.block_no (parsed by Python); short chart label "B<n>"
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
      readonly week: WeekNav | null; // null if weekly_load has no row for the latest date
    };

/** The selected ISO week plus `?week=` values for its neighbours (null at either end). */
export type WeekNav = {
  readonly selected: WeekView;
  readonly param: string; // e.g. "2026-W40"
  readonly isLatest: boolean;
  readonly prev: string | null;
  readonly next: string | null;
};

export type RideDetail = {
  readonly id: string;
  readonly name: string | null;
  readonly startTime: string; // "HH:MM" local, from start_date_local
  readonly movingTimeS: number | null;
  readonly np: number | null; // W
  readonly intensityPct: number | null; // IF as a percent
  readonly tss: number | null;
  readonly device: string | null; // intervals.icu device_name, e.g. "HAMMERHEAD Karoo"
};

/** One exercise row of the sheet on that date; every set of a row has the same values. */
export type ExerciseDetail = {
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly sets: number;
  readonly reps: number;
  readonly loggedKg: number; // as logged (0 when blank)
  readonly bodyweight: boolean; // kg in the score = BODYWEIGHT + loggedKg
  readonly prescribed: string | null; // the coach's load cell, e.g. "RPE 7 - 8"
  readonly scorePerSet: number; // raw set score (before STRENGTH_K), from Python
};

export type StrengthDetail = {
  readonly strengthTss: number; // daily_load.strength_tss
  readonly sessions: readonly { readonly block: string; readonly week: number }[];
  readonly exercises: readonly ExerciseDetail[]; // in sheet (session) order
};

export type DayDetail = {
  readonly date: IsoDate;
  readonly cyclingTss: number;
  readonly strengthTss: number;
  readonly totalTss: number;
  readonly rides: readonly RideDetail[];
  readonly strength: StrengthDetail | null; // only when Python counted strength that day
  readonly rest: boolean; // no ride and no counted strength: no expander
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
      return { name: b.name, blockNo: b.blockNo, start: b.startDate, end, deloadStart, ongoing };
    });
}

/**
 * The weekly_load row with weekStart <= latest <= weekEnd, plus the daily rows in that range.
 * Null when there is none.
 */
export function currentWeek(data: DashboardData, latest: IsoDate): WeekView | null {
  const week = data.weeks.find((w) => w.weekStart <= latest && latest <= w.weekEnd);
  return week === undefined ? null : weekView(data, week);
}

/** A weekly_load row plus the daily_load rows inside it. */
export function weekView(data: DashboardData, week: WeeklyLoadRow): WeekView {
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

/** `?week=` value for a week, e.g. "2026-W40". */
export function weekParam(week: { readonly isoYear: number; readonly isoWeek: number }): string {
  return `${week.isoYear}-W${String(week.isoWeek).padStart(2, "0")}`;
}

/**
 * The week named by `param` (e.g. "2026-W39"), else the week containing `latest`. Only weeks
 * up to the latest one can be selected. Null when weekly_load has no row for `latest`.
 */
export function selectWeek(
  data: DashboardData,
  latest: IsoDate,
  param: string | undefined,
): WeekNav | null {
  const weeks = data.weeks.toSorted((a, b) => a.weekStart.localeCompare(b.weekStart));
  const latestIndex = weeks.findIndex((w) => w.weekStart <= latest && latest <= w.weekEnd);
  if (latestIndex === -1) return null;
  const requested = param === undefined ? -1 : weeks.findIndex((w) => weekParam(w) === param);
  const index = requested !== -1 && requested <= latestIndex ? requested : latestIndex;
  const selected = weeks[index];
  return {
    selected: weekView(data, selected),
    param: weekParam(selected),
    isLatest: index === latestIndex,
    prev: index > 0 ? weekParam(weeks[index - 1]) : null,
    next: index < latestIndex ? weekParam(weeks[index + 1]) : null,
  };
}

function rideDetail(a: ActivityRow): RideDetail {
  return {
    id: a.id,
    name: a.name,
    startTime: a.startDateLocal.slice(11, 16),
    movingTimeS: a.movingTimeS,
    np: a.weightedAvgWatts,
    intensityPct: a.intensityPct,
    tss: a.trainingLoad,
    device: a.deviceName,
  };
}

function strengthDetail(strengthTss: number, sets: readonly StrengthSetRow[]): StrengthDetail {
  const ordered = sets.toSorted(
    (a, b) => a.block.localeCompare(b.block) || a.sheetRow - b.sheetRow || a.setNo - b.setNo,
  );
  const exercises = new Map<string, { first: StrengthSetRow; sets: number }>();
  const sessions = new Map<string, { block: string; week: number }>();
  for (const s of ordered) {
    const key = `${s.block}#${s.sheetRow}`;
    const seen = exercises.get(key);
    if (seen === undefined) exercises.set(key, { first: s, sets: 1 });
    else seen.sets += 1;
    sessions.set(`${s.block}#${s.week}`, { block: s.block, week: s.week });
  }
  return {
    strengthTss,
    sessions: [...sessions.values()],
    exercises: [...exercises].map(([key, { first, sets: count }]) => ({
      key,
      name: first.name,
      type: first.type,
      sets: count,
      reps: first.reps,
      loggedKg: first.loggedKg,
      bodyweight: first.bodyweight,
      prescribed: first.prescribed,
      scorePerSet: first.score,
    })),
  };
}

/**
 * One entry per daily_load day of the week. Strength shows only when Python counted it
 * (strengthTss > 0): sets of weeks that aren't logged yet are plan, not load.
 */
export function dayDetails(week: WeekView, detail: WeekDetailData): DayDetail[] {
  return week.days.map((day) => {
    const rides = detail.activities
      .filter((a) => a.startDateLocal.slice(0, 10) === day.date)
      .map(rideDetail);
    const sets = detail.sets.filter((s) => s.date === day.date);
    const strength =
      day.strengthTss > 0 && sets.length > 0 ? strengthDetail(day.strengthTss, sets) : null;
    return { ...day, rides, strength, rest: rides.length === 0 && strength === null };
  });
}

/** Composes the helpers above. "empty" when data.daily is empty. */
export function buildDashboardView(
  data: DashboardData,
  now: Date,
  week?: string,
): DashboardView {
  const latest = data.daily.at(-1);
  if (latest === undefined) return { kind: "empty" };
  return {
    kind: "ready",
    hero: hero(latest),
    freshness: freshness(latest.computedAt, now),
    chart: data.daily.map((d) => ({ date: d.date, ctl: d.ctl, atl: d.atl, tsb: d.tsb })),
    blocks: blockSpans(data.blocks, latest.date),
    week: selectWeek(data, latest.date, week),
  };
}
