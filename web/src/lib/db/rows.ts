import "server-only";

import type { DataError } from "../data-error.ts";

/**
 * Row types + runtime validation for the three read-only sources. PostgREST JSON is
 * `unknown` until a parser here has narrowed it (no `any`, no casts). Parsers throw
 * RowError naming table + column, never the value (mirrors python/src/training_load/narrow.py).
 * Numbers must be finite JSON numbers (booleans and numeric strings are rejected).
 * Columns are mapped snake_case -> camelCase here and nowhere else.
 */

/** Calendar date "YYYY-MM-DD" as PostgREST returns a Postgres `date`. No time zone. */
export type IsoDate = string;

/** public.daily_load (one row per local date, SERIES_START .. compute day). */
export type DailyLoadRow = {
  readonly date: IsoDate;
  readonly cyclingTss: number;
  readonly strengthTss: number;
  readonly totalTss: number;
  readonly ctl: number;
  readonly atl: number;
  readonly tsb: number;
  readonly ctlRamp7d: number | null; // null for the first 7 days of the series
  readonly formZone: string | null; // Python FormZone key; label set owned by Python
  readonly computedAt: string | null; // ISO timestamptz (UTC); null for pre-M2 rows
};

/** public.blocks. Deload week = [deloadStart, endDate] when deloadStart is not null. */
export type BlockRow = {
  readonly name: string;
  readonly blockNo: number;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate | null;
  readonly deloadStart: IsoDate | null;
};

/** public.weekly_load (ISO week Mon-Sun, SUMs over daily_load). */
export type WeeklyLoadRow = {
  readonly weekStart: IsoDate;
  readonly weekEnd: IsoDate;
  readonly isoYear: number;
  readonly isoWeek: number;
  readonly cyclingTss: number;
  readonly strengthTss: number;
  readonly totalTss: number;
  readonly days: number; // < 7 marks a partial week
};

/** Everything the page reads, as returned by queries.loadDashboardData. */
export type DashboardData = {
  readonly daily: readonly DailyLoadRow[]; // ascending by date
  readonly blocks: readonly BlockRow[]; // ascending by startDate
  readonly weeks: readonly WeeklyLoadRow[]; // ascending by weekStart
  /** The prognose, ascending by date; null when it couldn't be read (the page still renders). */
  readonly projection: readonly DailyProjectionRow[] | null;
};

/** A planned ride in daily_projection.basis: its NP-style TSS, or null with Python's reason. */
export type ProjectedRide = {
  readonly name: string;
  readonly tss: number | null;
  readonly reason: string | null; // why tss is null (the steps couldn't be read)
};

/** A low-high range Python computed; the web draws it, never recomputes it. */
export type Band = { readonly low: number; readonly high: number };

/** How Python estimated strength: the coach's plan (inside the block) or the recent weeks. */
export type StrengthMethod = "plan" | "recent";

/** A strength session Python placed on a future day (an estimate). */
export type ProjectedSession = {
  readonly session: number;
  readonly tss: number | null; // null: not counted; `reason` says why
  readonly dayEstimated: boolean; // the weekday was spread or moved, not learnt
  readonly reason: string | null; // e.g. "no day left this week"
  readonly method: StrengthMethod;
  readonly tssBand: Band | null; // recent sessions with data: the weekly min-max over N sessions
  readonly recentWeeks: number | null; // recent sessions with data: weeks the mean is from
  readonly unscored: number | null; // plan sessions: sets without a kg rule (left out); null if recent
};

/** public.daily_projection: the prognose (estimates only), rebuilt by compute. */
export type DailyProjectionRow = {
  readonly date: IsoDate;
  readonly cyclingTss: number;
  readonly strengthTss: number;
  readonly ctl: number;
  readonly atl: number;
  readonly tsb: number;
  readonly cyclingSource: "planned" | "typical_week";
  readonly rides: readonly ProjectedRide[];
  readonly sessions: readonly ProjectedSession[];
  readonly strengthMethod: StrengthMethod;
  // The uncertainty band after the strength block (low <= value <= high); null inside the block.
  readonly ctlBand: Band | null;
  readonly atlBand: Band | null;
  readonly tsbBand: Band | null;
};

export const PROJECTION_SELECT = {
  table: "daily_projection",
  columns:
    "date,cycling_tss,strength_tss,ctl,atl,tsb,basis,strength_method,ctl_low,ctl_high,atl_low,atl_high,tsb_low,tsb_high",
  order: "date", // the primary key
} as const;

export const DAILY_LOAD_SELECT = {
  table: "daily_load",
  columns:
    "date,cycling_tss,strength_tss,total_tss,ctl,atl,tsb,ctl_ramp_7d,form_zone,computed_at",
  order: "date",
} as const;

export const BLOCKS_SELECT = {
  table: "blocks",
  columns: "name,block_no,start_date,end_date,deload_start",
  order: "start_date,sheet_id,name", // unique (includes the primary key)
} as const;

export const WEEKLY_LOAD_SELECT = {
  table: "weekly_load",
  columns: "week_start,week_end,iso_year,iso_week,cycling_tss,strength_tss,total_tss,days",
  order: "week_start", // unique: one row per ISO week
} as const;

/** public.activities (cycling only), for the week detail. start_date_local is naive local time. */
export type ActivityRow = {
  readonly id: string;
  readonly startDateLocal: string; // "YYYY-MM-DDTHH:MM:SS", athlete-local wall clock
  readonly type: string;
  readonly name: string | null;
  readonly movingTimeS: number | null;
  readonly weightedAvgWatts: number | null; // NP
  readonly intensityPct: number | null; // IF as a percent (85.3 == 0.853)
  readonly trainingLoad: number | null; // TSS (intervals.icu load)
  readonly deviceName: string | null;
};

/** public.strength_sets, for the week detail. score is the raw per-set score (before K). */
export type StrengthSetRow = {
  readonly weekStart: IsoDate; // Monday of the ISO week
  readonly session: number; // 1..N within the ISO week
  readonly block: string;
  readonly week: number;
  readonly sheetRow: number;
  readonly setNo: number;
  readonly type: string;
  readonly name: string;
  readonly reps: number;
  readonly loggedKg: number | null; // null: not entered/unreadable; 0 is real only if bodyweight (bodyweight only)
  readonly kg: number;
  readonly bodyweight: boolean;
  readonly rpe: number | null;
  readonly prescribed: string | null;
  readonly score: number;
};

/**
 * public.strength_sessions (derived by Python): one row per (ISO week, session number).
 * date is null until a strength activity is logged (the n-th activity of the week is
 * session n); block/week are null for an extra activity beyond the program (tss 0).
 */
export type StrengthSessionRow = {
  readonly weekStart: IsoDate;
  readonly session: number;
  readonly block: string | null;
  readonly week: number | null;
  readonly activityId: string | null;
  readonly date: IsoDate | null;
  readonly activityName: string | null;
  readonly movingTimeS: number | null;
  readonly tss: number; // strength TSS on `date` (0 when undone or extra)
};

/** The selected week's sessions, as returned by queries.loadWeekDetail. */
export type WeekDetailData = {
  readonly activities: readonly ActivityRow[]; // ascending by start
  readonly sessions: readonly StrengthSessionRow[]; // done in the week, by week and number
  readonly sets: readonly StrengthSetRow[]; // the ISO week's prescription, by session, sheet order
};

export const ACTIVITIES_SELECT = {
  table: "activities",
  columns:
    "id,start_date_local,type,name,moving_time_s,weighted_avg_watts,intensity_pct,training_load,device_name",
  order: "start_date_local,id", // unique (includes the primary key)
} as const;

export const STRENGTH_SETS_SELECT = {
  table: "strength_sets",
  columns:
    "week_start,session,sheet_id,block,week,sheet_row,set_no,type,name,reps,logged_kg,kg,bodyweight,rpe,prescribed,score",
  order: "week_start,session,sheet_id,block,sheet_row,week,set_no", // unique (includes the primary key)
} as const;

export const STRENGTH_SESSIONS_SELECT = {
  table: "strength_sessions",
  columns: "week_start,session,block,week,activity_id,date,activity_name,moving_time_s,tss",
  order: "week_start,session", // the primary key
} as const;

/** Why Python left a ride out of the trends (domain.ride_analysis.Exclusion). */
export type RideExclusion = "no_raw" | "too_short" | "power_outlier" | "hr_outlier";
const RIDE_EXCLUSIONS: readonly RideExclusion[] = ["no_raw", "too_short", "power_outlier", "hr_outlier"];

/**
 * public.ride_metrics: every ride since 2024-12-30, rebuilt by compute (domain.ride_analysis).
 * Every number and flag is Python's; the web formats and draws, never recomputes.
 */
export type RideMetricsRow = {
  readonly activityId: string;
  readonly date: IsoDate; // local date of the ride
  readonly type: string; // Ride | VirtualRide
  readonly movingS: number | null;
  readonly distanceM: number | null;
  readonly load: number | null;
  readonly npW: number | null;
  readonly avgHr: number | null;
  readonly deviceWatts: boolean | null; // true = a real power meter
  readonly ftpW: number | null; // the FTP set in intervals.icu at the time
  readonly ifSet: number | null; // intervals.icu IF (ratio) on ftpW
  readonly rollingFtpW: number | null; // intervals.icu's eFTP that day
  readonly ifEftp: number | null; // NP / rollingFtpW
  readonly ef: number | null; // NP / average HR
  readonly exclusion: RideExclusion | null; // null = in the trends
  readonly eftpOk: boolean; // a point on the eFTP line
  readonly eftpGapBefore: boolean; // the eFTP line breaks before this point
  readonly efOk: boolean; // a point on the EF line
  readonly efTrend: number | null; // 28-day median EF; null unless efOk
  readonly efGapBefore: boolean; // the EF line breaks before this point
  readonly eftpYearAgoDate: IsoDate | null; // the comparison point a year earlier (eFTP points)
  readonly eftpYearAgoW: number | null;
  readonly eftpDeltaW: number | null; // rollingFtpW - eftpYearAgoW
  readonly computedAt: string; // ISO timestamptz (UTC)
};

/** public.cycling_weeks: one row per ISO week since 2024-12-30; rides = 0 is a real 0. */
export type CyclingWeekRow = {
  readonly weekStart: IsoDate;
  readonly rides: number;
  readonly movingS: number;
  readonly load: number;
  readonly excluded: number; // rides that week left out of the trends
  readonly computedAt: string;
};

/** Everything /analyse reads, as returned by queries.loadCyclingAnalysis. */
export type CyclingAnalysisData = {
  readonly rides: readonly RideMetricsRow[]; // ascending by date
  /** Ascending by weekStart; null when they couldn't be read (that card shows an error). */
  readonly weeks: readonly CyclingWeekRow[] | null;
  /** Why weeks is null (set by loadCyclingAnalysis); absent/null when they were read. */
  readonly weeksError?: DataError | null;
};

export const RIDE_METRICS_SELECT = {
  table: "ride_metrics",
  columns:
    "activity_id,date,type,moving_s,distance_m,load,np_w,avg_hr,device_watts,ftp_w,if_set,rolling_ftp_w,if_eftp,ef,exclusion,eftp_ok,eftp_gap_before,ef_ok,ef_trend,ef_gap_before,eftp_year_ago_date,eftp_year_ago_w,eftp_delta_w,computed_at",
  order: "date,activity_id", // unique (includes the primary key)
} as const;

export const CYCLING_WEEKS_SELECT = {
  table: "cycling_weeks",
  columns: "week_start,rides,moving_s,load,excluded,computed_at",
  order: "week_start", // the primary key
} as const;

/** Program phase of a strength block (Python: domain.strength_analysis.PHASES). */
export type StrengthPhase = "in_season" | "off_season";
const PHASES: readonly StrengthPhase[] = ["in_season", "off_season"];

/** How a week's lifted kg counts: matched to an activity, or before the activity log (blok 11). */
export type StrengthStatus = "lifted" | "pre_log";
const STATUSES: readonly StrengthStatus[] = ["lifted", "pre_log"];

/** Which RPE an e1RM used: the user's logged LSRPE (counts) or the coach's prescribed RPE. */
export type RpeSource = "logged" | "prescribed";
const RPE_SOURCES: readonly RpeSource[] = ["logged", "prescribed"];

export type StrengthLift = "SQUAT" | "BENCH" | "DEADLIFT";
const LIFTS: readonly StrengthLift[] = ["SQUAT", "BENCH", "DEADLIFT"];

/**
 * public.strength_weeks: one row per ISO week x lift, rebuilt by compute
 * (domain.strength_analysis). Lifted kg only; every number is Python's.
 */
export type StrengthWeekRow = {
  readonly weekStart: IsoDate;
  readonly lift: StrengthLift;
  readonly block: string | null; // null: a week between blocks
  readonly blockNo: number | null;
  readonly phase: StrengthPhase | null;
  readonly status: StrengthStatus | null; // null: nothing lifted that week
  readonly setsLifted: number;
  readonly tonnageKg: number; // 0 = nothing lifted (a real 0)
  readonly e1rmKg: number | null; // the week's best set; null when no qualifying set
  readonly e1rmLoadKg: number | null;
  readonly e1rmReps: number | null;
  readonly e1rmRpe: number | null;
  readonly e1rmRpeSource: RpeSource | null;
  readonly isBlockBest: boolean;
  readonly computedAt: string;
};

/** public.blocks with the phase, for /analyse/styrke. */
export type StrengthBlockRow = {
  readonly name: string;
  readonly blockNo: number;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate | null;
  readonly deloadStart: IsoDate | null;
  readonly phase: StrengthPhase | null; // null until compute has run on the phase migration
};

/** The tab's 1RM table value for a lift (an input, "1RM i arket (ikke testet)"), per set row. */
export type SheetOneRmRow = {
  readonly block: string;
  readonly lift: StrengthLift;
  readonly kg: number;
};

/** Everything /analyse/styrke reads, as returned by queries.loadStrengthAnalysis. */
export type StrengthAnalysisData = {
  readonly weeks: readonly StrengthWeekRow[]; // ascending by weekStart, then lift
  readonly blocks: readonly StrengthBlockRow[]; // ascending by startDate
  readonly sheetOneRm: readonly SheetOneRmRow[]; // one row per main-lift set; the view dedups
};

export const STRENGTH_WEEKS_SELECT = {
  table: "strength_weeks",
  columns:
    "week_start,lift,block,block_no,phase,status,sets_lifted,tonnage_kg,e1rm_kg,e1rm_load_kg,e1rm_reps,e1rm_rpe,e1rm_rpe_source,is_block_best,computed_at",
  order: "week_start,lift", // the primary key
} as const;

export const STRENGTH_BLOCKS_SELECT = {
  table: "blocks",
  columns: "name,block_no,start_date,end_date,deload_start,phase",
  order: "start_date,sheet_id,name", // unique (includes the primary key)
} as const;

export const SHEET_ONE_RM_SELECT = {
  table: "strength_sets",
  columns: "block,type,e1rm",
  order: "sheet_id,block,sheet_row,week,set_no", // the primary key
  filters: [
    ["e1rm", "not.is.null"],
    ["type", "in.(SQUAT,BENCH,DEADLIFT)"],
  ],
} as const;

export class RowError extends Error {}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Narrows one JSON row; every accessor names table + column on failure, never the value. */
class Fields {
  private readonly table: string;
  private readonly row: object;

  constructor(table: string, raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new RowError(`${table}: expected a JSON object per row`);
    }
    this.table = table;
    this.row = raw;
  }

  private get(column: string): unknown {
    return Object.getOwnPropertyDescriptor(this.row, column)?.value;
  }

  private fail(column: string, expected: string): never {
    throw new RowError(`${this.table}.${column}: expected ${expected}`);
  }

  string(column: string): string {
    const value = this.get(column);
    return typeof value === "string" ? value : this.fail(column, "a string");
  }

  stringOrNull(column: string): string | null {
    return this.get(column) === null ? null : this.string(column);
  }

  /** For JSON objects whose writer leaves a key out when it has nothing to say (basis.reason). */
  optionalString(column: string): string | null {
    const value = this.get(column);
    return value === undefined || value === null ? null : this.string(column);
  }

  number(column: string): number {
    const value = this.get(column);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : this.fail(column, "a finite number");
  }

  numberOrNull(column: string): number | null {
    return this.get(column) === null ? null : this.number(column);
  }

  /** For JSON objects whose writer leaves a key out when it doesn't apply (basis.tss_low). */
  optionalNumber(column: string): number | null {
    const value = this.get(column);
    return value === undefined || value === null ? null : this.number(column);
  }

  date(column: string): IsoDate {
    const value = this.string(column);
    return ISO_DATE.test(value) ? value : this.fail(column, "a YYYY-MM-DD date");
  }

  dateOrNull(column: string): IsoDate | null {
    return this.get(column) === null ? null : this.date(column);
  }

  /** The raw JSON value; the caller narrows it (e.g. a jsonb column). */
  unknown(column: string): unknown {
    return this.get(column);
  }

  array(column: string): readonly unknown[] {
    const value = this.get(column);
    return Array.isArray(value) ? value : this.fail(column, "an array");
  }

  timestamp(column: string): string {
    const value = this.string(column);
    return Number.isNaN(Date.parse(value)) ? this.fail(column, "a timestamp") : value;
  }

  booleanOrNull(column: string): boolean | null {
    return this.get(column) === null ? null : this.boolean(column);
  }

  boolean(column: string): boolean {
    const value = this.get(column);
    return typeof value === "boolean" ? value : this.fail(column, "a boolean");
  }

  localDateTime(column: string): string {
    const value = this.string(column);
    return LOCAL_DATE_TIME.test(value) ? value : this.fail(column, "a YYYY-MM-DDTHH:MM:SS time");
  }

  timestampOrNull(column: string): string | null {
    const value = this.stringOrNull(column);
    if (value !== null && Number.isNaN(Date.parse(value))) this.fail(column, "a timestamp");
    return value;
  }
}

export function parseDailyLoadRow(raw: unknown): DailyLoadRow {
  const f = new Fields(DAILY_LOAD_SELECT.table, raw);
  return {
    date: f.date("date"),
    cyclingTss: f.number("cycling_tss"),
    strengthTss: f.number("strength_tss"),
    totalTss: f.number("total_tss"),
    ctl: f.number("ctl"),
    atl: f.number("atl"),
    tsb: f.number("tsb"),
    ctlRamp7d: f.numberOrNull("ctl_ramp_7d"),
    formZone: f.stringOrNull("form_zone"),
    computedAt: f.timestampOrNull("computed_at"),
  };
}

export function parseRideMetricsRow(raw: unknown): RideMetricsRow {
  const f = new Fields(RIDE_METRICS_SELECT.table, raw);
  const exclusion = f.stringOrNull("exclusion");
  const known = RIDE_EXCLUSIONS.find((e) => e === exclusion);
  if (exclusion !== null && known === undefined) {
    throw new RowError(`${RIDE_METRICS_SELECT.table}.exclusion: expected one of ${RIDE_EXCLUSIONS.join(", ")}`);
  }
  return {
    activityId: f.string("activity_id"),
    date: f.date("date"),
    type: f.string("type"),
    movingS: f.numberOrNull("moving_s"),
    distanceM: f.numberOrNull("distance_m"),
    load: f.numberOrNull("load"),
    npW: f.numberOrNull("np_w"),
    avgHr: f.numberOrNull("avg_hr"),
    deviceWatts: f.booleanOrNull("device_watts"),
    ftpW: f.numberOrNull("ftp_w"),
    ifSet: f.numberOrNull("if_set"),
    rollingFtpW: f.numberOrNull("rolling_ftp_w"),
    ifEftp: f.numberOrNull("if_eftp"),
    ef: f.numberOrNull("ef"),
    exclusion: known ?? null,
    eftpOk: f.boolean("eftp_ok"),
    eftpGapBefore: f.boolean("eftp_gap_before"),
    efOk: f.boolean("ef_ok"),
    efTrend: f.numberOrNull("ef_trend"),
    efGapBefore: f.boolean("ef_gap_before"),
    eftpYearAgoDate: f.dateOrNull("eftp_year_ago_date"),
    eftpYearAgoW: f.numberOrNull("eftp_year_ago_w"),
    eftpDeltaW: f.numberOrNull("eftp_delta_w"),
    computedAt: f.timestamp("computed_at"),
  };
}

export function parseCyclingWeekRow(raw: unknown): CyclingWeekRow {
  const f = new Fields(CYCLING_WEEKS_SELECT.table, raw);
  return {
    weekStart: f.date("week_start"),
    rides: f.number("rides"),
    movingS: f.number("moving_s"),
    load: f.number("load"),
    excluded: f.number("excluded"),
    computedAt: f.timestamp("computed_at"),
  };
}

function oneOf<T extends string>(table: string, column: string, value: string | null, allowed: readonly T[]): T | null {
  if (value === null) return null;
  const known = allowed.find((a) => a === value);
  if (known === undefined) throw new RowError(`${table}.${column}: expected one of ${allowed.join(", ")}`);
  return known;
}

export function parseStrengthWeekRow(raw: unknown): StrengthWeekRow {
  const t = STRENGTH_WEEKS_SELECT.table;
  const f = new Fields(t, raw);
  const lift = oneOf(t, "lift", f.string("lift"), LIFTS);
  if (lift === null) throw new RowError(`${t}.lift: expected a lift`);
  return {
    weekStart: f.date("week_start"),
    lift,
    block: f.stringOrNull("block"),
    blockNo: f.numberOrNull("block_no"),
    phase: oneOf(t, "phase", f.stringOrNull("phase"), PHASES),
    status: oneOf(t, "status", f.stringOrNull("status"), STATUSES),
    setsLifted: f.number("sets_lifted"),
    tonnageKg: f.number("tonnage_kg"),
    e1rmKg: f.numberOrNull("e1rm_kg"),
    e1rmLoadKg: f.numberOrNull("e1rm_load_kg"),
    e1rmReps: f.numberOrNull("e1rm_reps"),
    e1rmRpe: f.numberOrNull("e1rm_rpe"),
    e1rmRpeSource: oneOf(t, "e1rm_rpe_source", f.stringOrNull("e1rm_rpe_source"), RPE_SOURCES),
    isBlockBest: f.boolean("is_block_best"),
    computedAt: f.timestamp("computed_at"),
  };
}

export function parseStrengthBlockRow(raw: unknown): StrengthBlockRow {
  const t = STRENGTH_BLOCKS_SELECT.table;
  const f = new Fields(t, raw);
  return {
    name: f.string("name"),
    blockNo: f.number("block_no"),
    startDate: f.date("start_date"),
    endDate: f.dateOrNull("end_date"),
    deloadStart: f.dateOrNull("deload_start"),
    phase: oneOf(t, "phase", f.stringOrNull("phase"), PHASES),
  };
}

export function parseSheetOneRmRow(raw: unknown): SheetOneRmRow {
  const t = SHEET_ONE_RM_SELECT.table;
  const f = new Fields(t, raw);
  const lift = oneOf(t, "type", f.string("type"), LIFTS);
  if (lift === null) throw new RowError(`${t}.type: expected a lift`);
  return { block: f.string("block"), lift, kg: f.number("e1rm") };
}

export function parseBlockRow(raw: unknown): BlockRow {
  const f = new Fields(BLOCKS_SELECT.table, raw);
  return {
    name: f.string("name"),
    blockNo: f.number("block_no"),
    startDate: f.date("start_date"),
    endDate: f.dateOrNull("end_date"),
    deloadStart: f.dateOrNull("deload_start"),
  };
}

export function parseWeeklyLoadRow(raw: unknown): WeeklyLoadRow {
  const f = new Fields(WEEKLY_LOAD_SELECT.table, raw);
  return {
    weekStart: f.date("week_start"),
    weekEnd: f.date("week_end"),
    isoYear: f.number("iso_year"),
    isoWeek: f.number("iso_week"),
    cyclingTss: f.number("cycling_tss"),
    strengthTss: f.number("strength_tss"),
    totalTss: f.number("total_tss"),
    days: f.number("days"),
  };
}

export function parseActivityRow(raw: unknown): ActivityRow {
  const f = new Fields(ACTIVITIES_SELECT.table, raw);
  return {
    id: f.string("id"),
    startDateLocal: f.localDateTime("start_date_local"),
    type: f.string("type"),
    name: f.stringOrNull("name"),
    movingTimeS: f.numberOrNull("moving_time_s"),
    weightedAvgWatts: f.numberOrNull("weighted_avg_watts"),
    intensityPct: f.numberOrNull("intensity_pct"),
    trainingLoad: f.numberOrNull("training_load"),
    deviceName: f.stringOrNull("device_name"),
  };
}

export function parseStrengthSetRow(raw: unknown): StrengthSetRow {
  const f = new Fields(STRENGTH_SETS_SELECT.table, raw);
  return {
    weekStart: f.date("week_start"),
    session: f.number("session"),
    block: f.string("block"),
    week: f.number("week"),
    sheetRow: f.number("sheet_row"),
    setNo: f.number("set_no"),
    type: f.string("type"),
    name: f.string("name"),
    reps: f.number("reps"),
    loggedKg: f.numberOrNull("logged_kg"),
    kg: f.number("kg"),
    bodyweight: f.boolean("bodyweight"),
    rpe: f.numberOrNull("rpe"),
    prescribed: f.stringOrNull("prescribed"),
    score: f.number("score"),
  };
}

export function parseStrengthSessionRow(raw: unknown): StrengthSessionRow {
  const f = new Fields(STRENGTH_SESSIONS_SELECT.table, raw);
  return {
    weekStart: f.date("week_start"),
    session: f.number("session"),
    block: f.stringOrNull("block"),
    week: f.numberOrNull("week"),
    activityId: f.stringOrNull("activity_id"),
    date: f.dateOrNull("date"),
    activityName: f.stringOrNull("activity_name"),
    movingTimeS: f.numberOrNull("moving_time_s"),
    tss: f.number("tss"),
  };
}

function strengthMethod(where: string, value: string): StrengthMethod {
  if (value !== "plan" && value !== "recent") throw new RowError(`${where}: unexpected value`);
  return value;
}

/** Both ends or neither; low <= high (Python's contract). */
function band(where: string, low: number | null, high: number | null): Band | null {
  if (low === null && high === null) return null;
  if (low === null || high === null || low > high) {
    throw new RowError(`${where}: expected both low <= high or neither`);
  }
  return { low, high };
}

export function parseProjectionRow(raw: unknown): DailyProjectionRow {
  const table = PROJECTION_SELECT.table;
  const f = new Fields(table, raw);
  const basis = new Fields(`${table}.basis`, f.unknown("basis"));
  const source = basis.string("cycling");
  if (source !== "planned" && source !== "typical_week") {
    throw new RowError(`${table}.basis.cycling: unexpected value`);
  }
  return {
    date: f.date("date"),
    cyclingTss: f.number("cycling_tss"),
    strengthTss: f.number("strength_tss"),
    ctl: f.number("ctl"),
    atl: f.number("atl"),
    tsb: f.number("tsb"),
    cyclingSource: source,
    rides: basis.array("rides").map((r, i) => {
      const ride = new Fields(`${PROJECTION_SELECT.table}.basis.rides[${i}]`, r);
      return { name: ride.string("name"), tss: ride.numberOrNull("tss"), reason: ride.optionalString("reason") };
    }),
    sessions: basis.array("strength").map((s, i) => {
      const where = `${table}.basis.strength[${i}]`;
      const entry = new Fields(where, s);
      const method = strengthMethod(`${where}.method`, entry.string("method"));
      const tss = entry.numberOrNull("tss");
      return {
        session: entry.number("session"),
        tss,
        dayEstimated: entry.boolean("day_estimated"),
        reason: entry.optionalString("reason"),
        method,
        tssBand: band(`${where}.tss_low/high`, entry.optionalNumber("tss_low"), entry.optionalNumber("tss_high")),
        // Python writes recent_weeks with every averaged session; missing is a contract break.
        recentWeeks: method === "recent" && tss !== null ? entry.number("recent_weeks") : entry.optionalNumber("recent_weeks"),
        unscored: entry.optionalNumber("unscored"),
      };
    }),
    strengthMethod: strengthMethod(`${table}.strength_method`, f.string("strength_method")),
    ctlBand: band(`${table}.ctl_low/high`, f.numberOrNull("ctl_low"), f.numberOrNull("ctl_high")),
    atlBand: band(`${table}.atl_low/high`, f.numberOrNull("atl_low"), f.numberOrNull("atl_high")),
    tsbBand: band(`${table}.tsb_low/high`, f.numberOrNull("tsb_low"), f.numberOrNull("tsb_high")),
  };
}

// --- Today screen ------------------------------------------------------------------------

/** One prescribed set of the coach's sheet (plan + what was logged), for the Today screen. */
export type PrescribedSetRow = {
  readonly weekStart: IsoDate; // Monday of the ISO week
  readonly session: number; // 1..N within the ISO week; never a weekday
  readonly block: string;
  readonly week: number;
  readonly sheetRow: number;
  readonly setNo: number;
  readonly name: string;
  readonly type: string;
  readonly setsText: string | null; // as written, e.g. "2"
  readonly repsText: string | null; // as written, e.g. "8 - 12"
  readonly prescribed: string | null; // as written, e.g. "RPE 6 - 7", "-10%"
  readonly loggedKg: number | null; // null: not entered/unreadable; 0 is real only if bodyweight (bodyweight only)
  readonly bodyweight: boolean;
};

export const PRESCRIBED_SETS_SELECT = {
  table: "strength_sets",
  columns:
    "week_start,session,sheet_id,block,week,sheet_row,set_no,name,type,sets_text,reps_text,prescribed,logged_kg,bodyweight",
  order: "week_start,session,sheet_id,block,sheet_row,week,set_no", // unique (includes the primary key)
} as const;

export function parsePrescribedSetRow(raw: unknown): PrescribedSetRow {
  const f = new Fields(PRESCRIBED_SETS_SELECT.table, raw);
  return {
    weekStart: f.date("week_start"),
    session: f.number("session"),
    block: f.string("block"),
    week: f.number("week"),
    sheetRow: f.number("sheet_row"),
    setNo: f.number("set_no"),
    name: f.string("name"),
    type: f.string("type"),
    setsText: f.stringOrNull("sets_text"),
    repsText: f.stringOrNull("reps_text"),
    prescribed: f.stringOrNull("prescribed"),
    loggedKg: f.numberOrNull("logged_kg"),
    bodyweight: f.boolean("bodyweight"),
  };
}

/** A planned-ride step with Python's watt targets (null watts when no FTP). */
export type PlanStep = {
  readonly kind: "step";
  readonly label: string | null;
  readonly minutes: number;
  readonly pctLow: number;
  readonly pctHigh: number;
  readonly wattsLow: number | null;
  readonly wattsHigh: number | null;
};

export type PlanItem =
  | PlanStep
  | { readonly kind: "repeat"; readonly repeat: number; readonly steps: readonly PlanStep[] };

/** public.planned_targets: a planned ride, derived by collect-plan. */
export type PlannedTargetRow = {
  readonly date: IsoDate;
  readonly name: string;
  readonly notes: string | null;
  readonly ftp: number | null;
  readonly totalMinutes: number;
  readonly steps: readonly PlanItem[];
  readonly problem: string | null; // plain words when the steps couldn't be read
  readonly computedAt: string;
};

export const PLANNED_TARGETS_SELECT = {
  table: "planned_targets",
  columns: "date,name,notes,ftp,total_minutes,steps,problem,computed_at",
  order: "date,name", // the primary key
} as const;

function parsePlanStep(raw: unknown, where: string): PlanStep {
  const f = new Fields(where, raw);
  if (f.string("kind") !== "step") throw new RowError(`${where}.kind: expected "step"`);
  return {
    kind: "step",
    label: f.stringOrNull("label"),
    minutes: f.number("minutes"),
    pctLow: f.number("pct_low"),
    pctHigh: f.number("pct_high"),
    wattsLow: f.numberOrNull("watts_low"),
    wattsHigh: f.numberOrNull("watts_high"),
  };
}

function parsePlanItems(raw: unknown, where: string): PlanItem[] {
  if (!Array.isArray(raw)) throw new RowError(`${where}: expected a JSON array`);
  const items: readonly unknown[] = raw;
  return items.map((item, i) => {
    const f = new Fields(`${where}[${i}]`, item);
    if (f.string("kind") !== "repeat") return parsePlanStep(item, `${where}[${i}]`);
    const inner = f.array("steps");
    return {
      kind: "repeat",
      repeat: f.number("repeat"),
      steps: inner.map((s, j) => parsePlanStep(s, `${where}[${i}].steps[${j}]`)),
    };
  });
}

export function parsePlannedTargetRow(raw: unknown): PlannedTargetRow {
  const f = new Fields(PLANNED_TARGETS_SELECT.table, raw);
  return {
    date: f.date("date"),
    name: f.string("name"),
    notes: f.stringOrNull("notes"),
    ftp: f.numberOrNull("ftp"),
    totalMinutes: f.number("total_minutes"),
    steps: parsePlanItems(f.unknown("steps"), `${PLANNED_TARGETS_SELECT.table}.steps`),
    problem: f.stringOrNull("problem"),
    computedAt: f.timestamp("computed_at"),
  };
}
