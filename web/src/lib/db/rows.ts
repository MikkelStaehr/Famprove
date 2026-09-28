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
};

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
  readonly date: IsoDate;
  readonly block: string;
  readonly week: number;
  readonly sheetRow: number;
  readonly setNo: number;
  readonly type: string;
  readonly name: string;
  readonly reps: number;
  readonly loggedKg: number;
  readonly kg: number;
  readonly bodyweight: boolean;
  readonly rpe: number | null;
  readonly prescribed: string | null;
  readonly score: number;
};

/** The selected week's sessions, as returned by queries.loadWeekDetail. */
export type WeekDetailData = {
  readonly activities: readonly ActivityRow[]; // ascending by start
  readonly sets: readonly StrengthSetRow[]; // ascending by date, then sheet order
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
    "date,sheet_id,block,week,sheet_row,set_no,type,name,reps,logged_kg,kg,bodyweight,rpe,prescribed,score",
  order: "date,sheet_id,block,sheet_row,week,set_no", // unique (includes the primary key)
} as const;

export class RowError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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

  number(column: string): number {
    const value = this.get(column);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : this.fail(column, "a finite number");
  }

  numberOrNull(column: string): number | null {
    return this.get(column) === null ? null : this.number(column);
  }

  date(column: string): IsoDate {
    const value = this.string(column);
    return ISO_DATE.test(value) ? value : this.fail(column, "a YYYY-MM-DD date");
  }

  dateOrNull(column: string): IsoDate | null {
    return this.get(column) === null ? null : this.date(column);
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
    date: f.date("date"),
    block: f.string("block"),
    week: f.number("week"),
    sheetRow: f.number("sheet_row"),
    setNo: f.number("set_no"),
    type: f.string("type"),
    name: f.string("name"),
    reps: f.number("reps"),
    loggedKg: f.number("logged_kg"),
    kg: f.number("kg"),
    bodyweight: f.boolean("bodyweight"),
    rpe: f.numberOrNull("rpe"),
    prescribed: f.stringOrNull("prescribed"),
    score: f.number("score"),
  };
}
