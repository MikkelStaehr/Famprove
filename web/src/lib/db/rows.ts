import "server-only";

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
