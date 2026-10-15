import "server-only";

import type { DataError } from "../data-error.ts";
import { LIFTS, type StrengthLift } from "../lifts.ts";

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

/**
 * public.weekly_plan (ISO week Mon-Sun): done TSS from daily_load and the prognose still to come.
 * done_tss: 0 is a real zero (a week of rest days). remaining_tss / planned_tss: null when the week
 * has no prognose day (past weeks, or nothing left this week), never 0 for "not planned".
 */
export type WeeklyPlanRow = {
  readonly weekStart: IsoDate;
  readonly weekEnd: IsoDate;
  readonly isoYear: number;
  readonly isoWeek: number;
  readonly doneTss: number;
  readonly remainingTss: number | null; // an estimate (daily_projection after the last daily_load day)
  readonly plannedTss: number | null; // doneTss + remainingTss; null with remainingTss
};

/** Everything the page reads, as returned by queries.loadDashboardData. */
export type DashboardData = {
  readonly daily: readonly DailyLoadRow[]; // ascending by date
  readonly blocks: readonly BlockRow[]; // ascending by startDate
  readonly weeks: readonly WeeklyLoadRow[]; // ascending by weekStart
  /** Done + planned TSS per week, ascending by weekStart; null when it couldn't be read (done only). */
  readonly weeklyPlan: readonly WeeklyPlanRow[] | null;
  /** The prognose, ascending by date; null when it couldn't be read (the page still renders). */
  readonly projection: readonly DailyProjectionRow[] | null;
};

/** A planned ride in daily_projection.basis: its NP-style TSS, or null with Python's reason. */
export type ProjectedRide = {
  readonly name: string;
  readonly tss: number | null;
  readonly reason: string | null; // why tss is null (the steps couldn't be read)
};

/** Where Python took a prognose day's cycling from (answers-round.md §1). */
export type CyclingSource = "planned" | "typical_week" | "calendar";

/** A planned ride in intervals.icu on a calendar prognose day; tss null = no load estimate. */
export type ProjectedEvent = {
  readonly name: string | null;
  readonly tss: number | null;
  readonly reason: string | null;
};

/** Python's counts over the prognose horizon (calendar days only); whole numbers >= 0. */
export type CalendarCounts = {
  readonly rides: number; // calendar_rides: events in the horizon
  readonly weeks: number; // calendar_weeks: ISO weeks with >= 1 event
  readonly noLoad: number | null; // calendar_no_load: events without a load (null: not written)
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
  readonly cyclingSource: CyclingSource;
  readonly typicalRides: number | null; // typical-week days: rides in the 28 days the week is built from
  // Calendar days (answers-round.md §1): the planned rides in intervals.icu that day ([] otherwise),
  // Python's horizon counts (null when the day is not a calendar day or the writer left them out),
  // and whether the day's event had no load, so it uses the typical week.
  readonly events: readonly ProjectedEvent[];
  readonly calendar: CalendarCounts | null;
  readonly typicalFallback: boolean;
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

export const WEEKLY_PLAN_SELECT = {
  table: "weekly_plan",
  columns: "week_start,week_end,iso_year,iso_week,done_tss,remaining_tss,planned_tss",
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
  /** Python's power-data warning (which rule fired, Danish); null = none. */
  readonly dataWarning: string | null;
};

/**
 * public.strength_sets, for the week detail. score is the parser's raw per-set score (before K);
 * scoreFinal is the one that feeds strength_sessions.tss and daily_load (compute: reps done, and
 * a main lift's %-row at the RPE from the app's rolling e1RM). Null only on rows from before
 * 2026-10-13.
 */
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
  readonly scoreFinal: number | null;
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

/**
 * public.ride_metrics' variability index for the week card (Python: NP / average power, 2 dp;
 * vi_warning = VI > 1.15 on a Z2 day). Null vi: missing or implausible; vi_warning is null then.
 */
export type RideViRow = {
  readonly activityId: string;
  readonly vi: number | null;
  readonly viWarning: boolean | null;
};

/** The selected week's sessions, as returned by queries.loadWeekDetail. */
export type WeekDetailData = {
  readonly activities: readonly ActivityRow[]; // ascending by start
  readonly rideVi: readonly RideViRow[]; // ride_metrics of those rides (rides before ANALYSIS_START have none)
  readonly sessions: readonly StrengthSessionRow[]; // done in the week, by week and number
  readonly sets: readonly StrengthSetRow[]; // the ISO week's prescription, by session, sheet order
};

export const ACTIVITIES_SELECT = {
  table: "activities",
  columns:
    "id,start_date_local,type,name,moving_time_s,weighted_avg_watts,intensity_pct,training_load,device_name,data_warning",
  order: "start_date_local,id", // unique (includes the primary key)
} as const;

export const STRENGTH_SETS_SELECT = {
  table: "strength_sets",
  columns:
    "week_start,session,sheet_id,block,week,sheet_row,set_no,type,name,reps,logged_kg,kg,bodyweight,rpe,prescribed,score,score_final",
  order: "week_start,session,sheet_id,block,sheet_row,week,set_no", // unique (includes the primary key)
} as const;

export const RIDE_VI_SELECT = {
  table: "ride_metrics",
  columns: "activity_id,vi,vi_warning",
  order: "activity_id", // the primary key
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
  readonly vi: number | null; // NP / average power, 2 dp; null = missing or implausible
  readonly viWarning: boolean | null; // VI > 1.15 on a Z2 day; null exactly when vi is null
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
  /**
   * The three answers (analyse.md §12); null when they couldn't be read (the blocks show an error,
   * the charts still render). Absent = not read (tests of the chart view).
   */
  readonly summary?: readonly AnalysisSummaryRow[] | null;
  /** Why summary is null (set by loadCyclingAnalysis). */
  readonly summaryError?: DataError | null;
};

/** The three questions on top of Cykel (python domain/cycling_answers.py). */
export type SummaryQuestion = "eftp" | "ef" | "volume";
export const SUMMARY_QUESTIONS: readonly SummaryQuestion[] = ["eftp", "ef", "volume"];
export type SummaryState = "answer" | "needs_data";
const SUMMARY_STATES: readonly SummaryState[] = ["answer", "needs_data"];
export type SummaryDirection = "up" | "down" | "flat";
const SUMMARY_DIRECTIONS: readonly SummaryDirection[] = ["up", "down", "flat"];

/**
 * public.analysis_summary, one row per question. Python writes every number and sentence; the web
 * renders verdictText/detailText verbatim. Zero vs null per field (migration comments):
 * value: eftp W / ef / volume h; 0 valid only for volume, null = none (eftp, ef). compare: 0 valid
 * only for volume, null = nothing to compare with. delta: 0 valid. haveN (ef only): 0 valid.
 * needN (ef only): > 0. target, targetSince (volume only). plannedN (volume): never 0, null = no
 * plan. doneN: 0 valid when plannedN is set, null exactly when plannedN is null.
 */
export type AnalysisSummaryRow = {
  readonly question: SummaryQuestion;
  readonly asOf: IsoDate;
  readonly computedAt: string;
  readonly state: SummaryState;
  readonly direction: SummaryDirection | null; // null exactly when state = needs_data
  readonly value: number | null;
  readonly valueDate: IsoDate | null;
  readonly compare: number | null;
  readonly compareDate: IsoDate | null;
  readonly delta: number | null;
  readonly haveN: number | null;
  readonly needN: number | null;
  readonly target: number | null;
  readonly targetSince: IsoDate | null;
  readonly plannedN: number | null;
  readonly doneN: number | null;
  readonly verdictText: string;
  readonly detailText: string | null;
};

export const ANALYSIS_SUMMARY_SELECT = {
  table: "analysis_summary",
  columns:
    "question,as_of,computed_at,state,direction,value,value_date,compare,compare_date,delta,have_n,need_n,target,target_since,planned_n,done_n,verdict_text,detail_text",
  order: "question", // the primary key
} as const;

export const RIDE_METRICS_SELECT = {
  table: "ride_metrics",
  columns:
    "activity_id,date,type,moving_s,distance_m,load,np_w,avg_hr,device_watts,ftp_w,if_set,rolling_ftp_w,if_eftp,ef,exclusion,eftp_ok,eftp_gap_before,ef_ok,ef_trend,ef_gap_before,eftp_year_ago_date,eftp_year_ago_w,eftp_delta_w,vi,vi_warning,computed_at",
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

export type { StrengthLift }; // defined once in lib/lifts.ts

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
  // answers-round.md §3: the best e1RM of the 4 ISO weeks ending with this one (the number the
  // suggestions use) and the week its set is from; both null together (no qualifying set).
  readonly rollingE1rmKg: number | null;
  readonly rollingE1rmWeek: IsoDate | null;
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
    "week_start,lift,block,block_no,phase,status,sets_lifted,tonnage_kg,e1rm_kg,e1rm_load_kg,e1rm_reps,e1rm_rpe,e1rm_rpe_source,is_block_best,rolling_e1rm_kg,rolling_e1rm_week,computed_at",
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
    vi: f.numberOrNull("vi"),
    viWarning: f.booleanOrNull("vi_warning"),
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

export function parseAnalysisSummaryRow(raw: unknown): AnalysisSummaryRow {
  const t = ANALYSIS_SUMMARY_SELECT.table;
  const f = new Fields(t, raw);
  const question = oneOf(t, "question", f.string("question"), SUMMARY_QUESTIONS);
  const state = oneOf(t, "state", f.string("state"), SUMMARY_STATES);
  if (question === null || state === null) throw new RowError(`${t}: expected question and state`);
  const direction = oneOf(t, "direction", f.stringOrNull("direction"), SUMMARY_DIRECTIONS);
  // The migration's checks, re-asserted: the figure row needs them, and a mismatch is never guessed.
  if ((state === "answer") !== (direction !== null)) {
    throw new RowError(`${t}.direction: expected a direction exactly when state is answer`);
  }
  const value = f.numberOrNull("value");
  const compare = f.numberOrNull("compare");
  const delta = f.numberOrNull("delta");
  if (state === "answer" && (value === null || compare === null || delta === null)) {
    throw new RowError(`${t}.value: expected value, compare and delta when state is answer`);
  }
  if (question === "eftp" && [value, compare].some((w) => w !== null && !Number.isInteger(w))) {
    throw new RowError(`${t}.value: expected whole watts for eftp`);
  }
  const haveN = f.numberOrNull("have_n");
  const needN = f.numberOrNull("need_n");
  if (question === "ef" && (haveN === null || needN === null)) {
    throw new RowError(`${t}.have_n: expected have_n and need_n for ef`);
  }
  const target = f.numberOrNull("target");
  if (question === "volume" && (state !== "answer" || target === null || value === null)) {
    throw new RowError(`${t}.target: expected an answer with value and target for volume`);
  }
  const plannedN = f.numberOrNull("planned_n");
  const doneN = f.numberOrNull("done_n");
  if ((plannedN === null) !== (doneN === null) || (plannedN !== null && doneN !== null && doneN > plannedN)) {
    throw new RowError(`${t}.done_n: expected done_n exactly with planned_n, and never above it`);
  }
  const verdictText = f.string("verdict_text");
  if (verdictText.trim() === "") throw new RowError(`${t}.verdict_text: expected a sentence`);
  return {
    question,
    asOf: f.date("as_of"),
    computedAt: f.timestamp("computed_at"),
    state,
    direction,
    value,
    valueDate: f.dateOrNull("value_date"),
    compare,
    compareDate: f.dateOrNull("compare_date"),
    delta,
    haveN,
    needN,
    target,
    targetSince: f.dateOrNull("target_since"),
    plannedN,
    doneN,
    verdictText,
    detailText: f.stringOrNull("detail_text"),
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
    ...rollingE1rm(f),
    computedAt: f.timestamp("computed_at"),
  };
}

/** rolling_e1rm_kg / rolling_e1rm_week: both or neither (a key the writer left out reads as null). */
function rollingE1rm(f: Fields): { readonly rollingE1rmKg: number | null; readonly rollingE1rmWeek: IsoDate | null } {
  const kg = f.optionalNumber("rolling_e1rm_kg");
  const week = f.optionalString("rolling_e1rm_week") === null ? null : f.date("rolling_e1rm_week");
  if ((kg === null) !== (week === null)) {
    throw new RowError(`${STRENGTH_WEEKS_SELECT.table}.rolling_e1rm_kg and rolling_e1rm_week must both be set or both be null`);
  }
  return { rollingE1rmKg: kg, rollingE1rmWeek: week };
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

export function parseWeeklyPlanRow(raw: unknown): WeeklyPlanRow {
  const f = new Fields(WEEKLY_PLAN_SELECT.table, raw);
  const remainingTss = f.numberOrNull("remaining_tss");
  const plannedTss = f.numberOrNull("planned_tss");
  // The view nulls both together; one without the other would be a planned value nobody can explain.
  if ((remainingTss === null) !== (plannedTss === null)) {
    throw new RowError(`${WEEKLY_PLAN_SELECT.table}.planned_tss: expected null exactly when remaining_tss is null`);
  }
  return {
    weekStart: f.date("week_start"),
    weekEnd: f.date("week_end"),
    isoYear: f.number("iso_year"),
    isoWeek: f.number("iso_week"),
    doneTss: f.number("done_tss"),
    remainingTss,
    plannedTss,
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
    dataWarning: f.stringOrNull("data_warning"),
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
    scoreFinal: f.numberOrNull("score_final"),
  };
}

export function parseRideViRow(raw: unknown): RideViRow {
  const f = new Fields(RIDE_VI_SELECT.table, raw);
  const vi = f.numberOrNull("vi");
  const viWarning = f.booleanOrNull("vi_warning");
  if ((vi === null) !== (viWarning === null)) {
    throw new RowError("ride_metrics.vi and vi_warning must both be set or both be null");
  }
  return { activityId: f.string("activity_id"), vi, viWarning };
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

/** A count of rides: a whole number >= 0, or null when the writer left it out. */
function rideCount(value: number | null, where: string): number | null {
  if (value !== null && (!Number.isInteger(value) || value < 0)) throw new RowError(`${where}: expected a whole number >= 0`);
  return value;
}

export function parseProjectionRow(raw: unknown): DailyProjectionRow {
  const table = PROJECTION_SELECT.table;
  const f = new Fields(table, raw);
  const basis = new Fields(`${table}.basis`, f.unknown("basis"));
  const source = basis.string("cycling");
  if (source !== "planned" && source !== "typical_week" && source !== "calendar") {
    throw new RowError(`${table}.basis.cycling: unexpected value`);
  }
  const fallback = basis.optionalString("fallback");
  if (fallback !== null && fallback !== "typical_week") throw new RowError(`${table}.basis.fallback: unexpected value`);
  const calendarRides = rideCount(basis.optionalNumber("calendar_rides"), `${table}.basis.calendar_rides`);
  const calendarWeeks = rideCount(basis.optionalNumber("calendar_weeks"), `${table}.basis.calendar_weeks`);
  const calendarNoLoad = rideCount(basis.optionalNumber("calendar_no_load"), `${table}.basis.calendar_no_load`);
  const rawEvents = basis.unknown("events");
  const events: ProjectedEvent[] =
    rawEvents === undefined || rawEvents === null
      ? []
      : basis.array("events").map((e, i) => {
          const event = new Fields(`${table}.basis.events[${i}]`, e);
          return { name: event.optionalString("name"), tss: event.optionalNumber("tss"), reason: event.optionalString("reason") };
        });
  return {
    date: f.date("date"),
    cyclingTss: f.number("cycling_tss"),
    strengthTss: f.number("strength_tss"),
    ctl: f.number("ctl"),
    atl: f.number("atl"),
    tsb: f.number("tsb"),
    cyclingSource: source,
    typicalRides: rideCount(basis.optionalNumber("typical_rides"), `${table}.basis.typical_rides`),
    events,
    calendar:
      source === "calendar" && calendarRides !== null && calendarWeeks !== null
        ? { rides: calendarRides, weeks: calendarWeeks, noLoad: calendarNoLoad }
        : null,
    typicalFallback: fallback === "typical_week",
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

// --- Træning screen ------------------------------------------------------------------------

/** One prescribed set of the coach's sheet (plan + what was logged), for the Træning screen. */
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
  /** strength_sets.variant_id: the sheet's NOTES variant in force; null = ukendt (matches only null). */
  readonly variantId: number | null;
  /** exercise_variants.display_name as shown; null without a variant or when it equals the exercise name. */
  readonly variant: string | null;
};

/** public.app_notices: one current notice per kind (e.g. ftp_mismatch), written by Python. */
export type AppNoticeRow = {
  readonly kind: string;
  readonly date: IsoDate;
  readonly message: string; // Danish, shown as is
  readonly updatedAt: string; // the run that last wrote it (ftp-confirm: an answer after it hides it)
};

export const APP_NOTICES_SELECT = {
  table: "app_notices",
  columns: "kind,date,message,updated_at",
  order: "kind", // the primary key
} as const;

export function parseAppNoticeRow(raw: unknown): AppNoticeRow {
  const f = new Fields(APP_NOTICES_SELECT.table, raw);
  return { kind: f.string("kind"), date: f.date("date"), message: f.string("message"), updatedAt: f.timestamp("updated_at") };
}

/** public.ftp_status (slice ftp-confirm; python domain/ftp_check.py). Every null = unknown or none, never 0. */
export type FtpStatusRow = {
  readonly ftpW: number | null; // the FTP set in intervals.icu
  readonly eftpW: number | null;
  readonly credible: boolean | null; // an 8-min effort at >= 90 % of the FTP in 42 days; null = no FTP
  readonly lastTestedOn: IsoDate | null; // null = no such effort in the last 52 weeks
  readonly ftpSince: IsoDate | null; // "sat senest": the first ride with this FTP; null = unknown
  readonly suppressedUntil: IsoDate | null; // after "230 W er rigtigt": the first day it may show again
};

export const FTP_STATUS_SELECT = {
  table: "ftp_status",
  columns: "singleton,ftp_w,eftp_w,credible,last_tested_on,ftp_since,suppressed_until",
  order: "singleton", // the primary key (one row)
} as const;

export function parseFtpStatusRow(raw: unknown): FtpStatusRow {
  const f = new Fields(FTP_STATUS_SELECT.table, raw);
  const positive = (column: string) => {
    const w = f.numberOrNull(column);
    if (w !== null && w <= 0) throw new RowError(`${FTP_STATUS_SELECT.table}.${column}: must be > 0 or null`);
    return w;
  };
  return {
    ftpW: positive("ftp_w"),
    eftpW: positive("eftp_w"),
    credible: f.booleanOrNull("credible"),
    lastTestedOn: f.dateOrNull("last_tested_on"),
    ftpSince: f.dateOrNull("ftp_since"),
    suppressedUntil: f.dateOrNull("suppressed_until"),
  };
}

/** public.ftp_ack: the user's answers to the FTP notice (written by lib/db/ftp-ack.ts), newest id wins. */
export type FtpAckChoice = "confirmed" | "fixed";
export type FtpAckRow = { readonly id: number; readonly choice: FtpAckChoice; readonly at: string };

export const FTP_ACK_SELECT = {
  table: "ftp_ack",
  columns: "id,choice,at",
  order: "id.desc", // newest first; selectFirst gives the latest answer
} as const;

export function parseFtpAckRow(raw: unknown): FtpAckRow {
  const f = new Fields(FTP_ACK_SELECT.table, raw);
  const choice = f.string("choice");
  if (choice !== "confirmed" && choice !== "fixed") throw new RowError(`${FTP_ACK_SELECT.table}.choice: ${choice}`);
  return { id: f.number("id"), choice, at: f.timestamp("at") };
}

/** Why a planned set has (or has no) suggested kg (python domain/planned_sets.py). */
/** new_variant: a named variant with nothing logged last week (no suggestion, no last week). */
export type SuggestionBasis = "rpe_e1rm" | "not_rpe" | "no_e1rm" | "no_lift" | "progression" | "new_variant";
const SUGGESTION_BASES: readonly SuggestionBasis[] = ["rpe_e1rm", "not_rpe", "no_e1rm", "no_lift", "progression", "new_variant"];

/** One step of a main lift's warm-up ramp (planned_sets.ramp): pct of the first working set's kg. */
export type RampStep = { readonly pct: number; readonly reps: number; readonly kg: number };

/**
 * public.planned_sets: suggested kg per set of this ISO week and later, computed by Python
 * (rolling e1RM of the exercise's parent lift x the RPE relation /analyse uses, rounded to 2.5).
 * Null suggestedKg: no suggestion (basis says why), never 0.
 */
export type PlannedSetRow = {
  readonly block: string;
  readonly sheetRow: number;
  readonly week: number;
  readonly setNo: number;
  readonly suggestedKg: number | null;
  readonly basis: SuggestionBasis;
  /** The suggestion before the weekly cap; null = not capped (the web then says nothing). */
  readonly uncappedKg: number | null;
  /** A progression step (2.5 / 5 kg) or 0 for hold; null = no rule fired. */
  readonly adjustmentKg: number | null;
  /** Danish, lowercase, shown after a dash ("de sidste to var lettere"); null exactly with adjustmentKg. */
  readonly adjustmentReason: string | null;
  /** Recommended rest after this set, in seconds; null on rows written before 2026-10-13. */
  readonly restMinS: number | null;
  readonly restMaxS: number | null;
  /** The warm-up ramp on a main lift's first set of a run; null = none. */
  readonly ramp: readonly RampStep[] | null;
};

export const PLANNED_SETS_SELECT = {
  table: "planned_sets",
  columns:
    "sheet_id,block,sheet_row,week,set_no,suggested_kg,basis,uncapped_kg,adjustment_kg,adjustment_reason,rest_min_s,rest_max_s,ramp",
  order: "sheet_id,block,sheet_row,week,set_no", // the primary key
} as const;

export function parsePlannedSetRow(raw: unknown): PlannedSetRow {
  const f = new Fields(PLANNED_SETS_SELECT.table, raw);
  const basis = f.string("basis");
  const known = SUGGESTION_BASES.find((b) => b === basis);
  if (known === undefined) throw new RowError(`planned_sets.basis: unknown value`);
  const suggestedKg = f.numberOrNull("suggested_kg");
  if (suggestedKg !== null && known !== "rpe_e1rm" && known !== "progression") {
    throw new RowError("planned_sets: a suggestion only with basis rpe_e1rm or progression");
  }
  const uncappedKg = f.numberOrNull("uncapped_kg");
  if (uncappedKg !== null && (suggestedKg === null || uncappedKg === suggestedKg)) {
    throw new RowError("planned_sets.uncapped_kg: only on a suggestion the cap changed");
  }
  return {
    block: f.string("block"),
    sheetRow: f.number("sheet_row"),
    week: f.number("week"),
    setNo: f.number("set_no"),
    suggestedKg,
    basis: known,
    uncappedKg,
    ...adjustmentOf(f),
    ...restOf(f),
    ramp: rampOf(f),
  };
}

function adjustmentOf(f: Fields): { adjustmentKg: number | null; adjustmentReason: string | null } {
  const adjustmentKg = f.optionalNumber("adjustment_kg");
  const adjustmentReason = f.optionalString("adjustment_reason");
  if ((adjustmentKg === null) !== (adjustmentReason === null)) {
    throw new RowError("planned_sets.adjustment_kg: expected a reason exactly with an adjustment");
  }
  if (adjustmentKg !== null && ![0, 2.5, 5].includes(adjustmentKg)) {
    throw new RowError("planned_sets.adjustment_kg: expected 0, 2.5 or 5");
  }
  return { adjustmentKg, adjustmentReason };
}

function restOf(f: Fields): { restMinS: number | null; restMaxS: number | null } {
  const restMinS = f.optionalNumber("rest_min_s");
  const restMaxS = f.optionalNumber("rest_max_s");
  if ((restMinS === null) !== (restMaxS === null) || (restMinS !== null && restMaxS !== null && (restMinS <= 0 || restMaxS < restMinS))) {
    throw new RowError("planned_sets.rest_min_s: expected 0 < min <= max, or both null");
  }
  return { restMinS, restMaxS };
}

function rampOf(f: Fields): readonly RampStep[] | null {
  const raw = f.unknown("ramp");
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw new RowError("planned_sets.ramp: expected an array");
  return raw.map((step: unknown) => {
    const s = new Fields("planned_sets.ramp", step);
    const kg = s.number("kg");
    if (kg <= 0) throw new RowError("planned_sets.ramp: expected kg > 0");
    return { pct: s.number("pct"), reps: s.number("reps"), kg };
  });
}

/**
 * public.exercise_set_log: one row per set of a strength session that has been begun, done or
 * skipped on the Træning screens (the app's only write, lib/db/set-log.ts). Timestamps are the
 * server's clock; a skipped set has none.
 */
export type SetLogRow = {
  readonly date: IsoDate;
  readonly session: number;
  readonly row: number; // strength_sets.sheet_row
  readonly set: number; // strength_sets.set_no
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly skipped: boolean;
  readonly updatedAt: string; // the row's latest write; for a skipped set, the skip's time
  readonly feltRpe: number | null; // -1 Lettere, 0 Som ventet, +1 Hårdere; null = not rated
  readonly repsDone: number | null; // reps done on a range set; null = none
};

export const SET_LOG_SELECT = {
  table: "exercise_set_log",
  columns: "date,session_no,row_no,set_no,kind,started_at,ended_at,skipped,updated_at,felt_rpe,reps_done",
  order: "date,session_no,row_no,set_no", // the primary key
} as const;

export function parseSetLogRow(raw: unknown): SetLogRow {
  const f = new Fields(SET_LOG_SELECT.table, raw);
  const row: SetLogRow = {
    date: f.date("date"),
    session: f.number("session_no"),
    row: f.number("row_no"),
    set: f.number("set_no"),
    startedAt: f.timestampOrNull("started_at"),
    endedAt: f.timestampOrNull("ended_at"),
    skipped: f.boolean("skipped"),
    updatedAt: f.timestamp("updated_at"),
    feltRpe: f.optionalNumber("felt_rpe"),
    repsDone: f.optionalNumber("reps_done"),
  };
  if (row.skipped && (row.startedAt !== null || row.endedAt !== null)) {
    throw new RowError("exercise_set_log: a skipped set has no timestamps");
  }
  const kind = f.optionalString("kind") ?? "set"; // rows read before the column existed are sets
  if ((kind === "warmup") !== (row.set === 0) || (kind !== "set" && kind !== "warmup")) {
    throw new RowError("exercise_set_log.kind: expected warmup exactly on set 0");
  }
  if (row.feltRpe !== null && ![-1, 0, 1].includes(row.feltRpe)) {
    throw new RowError("exercise_set_log.felt_rpe: expected -1, 0 or 1");
  }
  if (row.repsDone !== null && row.repsDone <= 0) throw new RowError("exercise_set_log.reps_done: expected > 0");
  return row;
}

export const PRESCRIBED_SETS_SELECT = {
  table: "strength_sets",
  columns:
    "week_start,session,sheet_id,block,week,sheet_row,set_no,name,type,sets_text,reps_text,prescribed,logged_kg,bodyweight,variant_id,exercise_variants(display_name)",
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
    ...variantOf(f, PRESCRIBED_SETS_SELECT.table, f.string("name")),
  };
}

/**
 * variant_id + the embedded exercise_variants(display_name) (PostgREST: an object, or null without
 * a variant). Both or neither. The display name is shown verbatim; one equal to the exercise name
 * (trimmed, case-insensitive) is no variant for the screens (variants.md). The web never resolves
 * aliases or normalises names: Python does.
 */
function variantOf(f: Fields, table: string, exerciseName: string): { variantId: number | null; variant: string | null } {
  const variantId = f.numberOrNull("variant_id");
  const embedded = f.unknown("exercise_variants");
  if (variantId === null) {
    if (embedded !== null) throw new RowError(`${table}.exercise_variants: expected null without a variant_id`);
    return { variantId: null, variant: null };
  }
  const display = new Fields(`${table}.exercise_variants`, embedded).string("display_name").trim();
  if (display === "") throw new RowError(`${table}.exercise_variants.display_name: expected a name`);
  const same = display.toLocaleLowerCase("da-DK") === exerciseName.trim().toLocaleLowerCase("da-DK");
  return { variantId, variant: same ? null : display };
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

/**
 * public.exercise_feel: one Danish line per exercise with 4+ rated sets, written by Python
 * (domain/set_feedback.py); shown verbatim on Analyse › Styrke.
 */
export type ExerciseFeelRow = {
  readonly exerciseId: number;
  readonly name: string; // public.exercises.name, embedded
  readonly variantId: number | null; // null = ukendt: its own line
  readonly variant: string | null; // exercise_variants.display_name; null as on Træning (variantOf)
  readonly ratedN: number;
  readonly verdictText: string;
};

export const EXERCISE_FEEL_SELECT = {
  table: "exercise_feel",
  columns: "exercise_id,variant_id,rated_n,verdict_text,exercises(name),exercise_variants(display_name)",
  order: "exercise_id,variant_id", // unique (nulls not distinct)
} as const;

export function parseExerciseFeelRow(raw: unknown): ExerciseFeelRow {
  const f = new Fields(EXERCISE_FEEL_SELECT.table, raw);
  const embedded = new Fields("exercise_feel.exercises", f.unknown("exercises"));
  const ratedN = f.number("rated_n");
  if (ratedN < 4) throw new RowError("exercise_feel.rated_n: expected at least 4");
  const verdictText = f.string("verdict_text");
  if (verdictText.trim() === "") throw new RowError("exercise_feel.verdict_text: expected a sentence");
  const name = embedded.string("name");
  return { exerciseId: f.number("exercise_id"), name, ...variantOf(f, EXERCISE_FEEL_SELECT.table, name), ratedN, verdictText };
}

/** public.exercises.category (schema check constraint; not null). */
export type ExerciseCategory = "main" | "accessory" | "isolation" | "bodyweight" | "abs";
const EXERCISE_CATEGORIES: readonly ExerciseCategory[] = ["main", "accessory", "isolation", "bodyweight", "abs"];

/** public.exercises' name, aliases and category: Fokus tells a main lift's warm-up from an accessory's. */
export type ExerciseCategoryRow = {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly category: ExerciseCategory;
};

export const EXERCISE_CATEGORY_SELECT = {
  table: "exercises",
  columns: "name,aliases,category",
  order: "id",
} as const;

export function parseExerciseCategoryRow(raw: unknown): ExerciseCategoryRow {
  const f = new Fields(EXERCISE_CATEGORY_SELECT.table, raw);
  const aliases = f.array("aliases").map((a) => {
    if (typeof a !== "string") throw new RowError("exercises.aliases: expected text values");
    return a;
  });
  const category = oneOf(EXERCISE_CATEGORY_SELECT.table, "category", f.string("category"), EXERCISE_CATEGORIES);
  if (category === null) throw new RowError("exercises.category: expected a category");
  return { name: f.string("name"), aliases, category };
}
