/**
 * Pure view model for the Today screen (no I/O, no React; tested with `node --test`).
 * It selects and groups what Python stored; it never calculates training numbers
 * (watts, TSB and zones all come from the database).
 */
import { freshness, zoneDisplay } from "./dashboard-view.ts";
import type { Freshness, Hero } from "./dashboard-view.ts";
import { addDays, isoWeekNumber } from "./dates.ts";
import type { TodayPlanData } from "./db/queries.ts";
import type {
  DailyLoadRow,
  IsoDate,
  PlanItem,
  PrescribedSetRow,
  StrengthSessionRow,
} from "./db/rows.ts";

export const LOCAL_TZ = "Europe/Copenhagen";

const LOCAL_DATE = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: LOCAL_TZ,
});

/** The local (Copenhagen) calendar date of `now`, e.g. "2026-09-28". */
export function localToday(now: Date): IsoDate {
  return LOCAL_DATE.format(now);
}

/**
 * The date the Today screen shows: the local date, or DEV_TODAY (YYYY-MM-DD) when running
 * under `next dev` — for looking at other days while developing. `nodeEnv` defaults to the
 * literal `process.env.NODE_ENV`, which the build inlines, so production never reads DEV_TODAY.
 * A malformed value is warned about, never silently ignored.
 */
export function resolveToday(
  now: Date,
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): IsoDate {
  const override = env.DEV_TODAY;
  if (nodeEnv !== "development" || !override) return localToday(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  console.warn(`DEV_TODAY=${override} ignored: expected YYYY-MM-DD`);
  return localToday(now);
}

export type Reference = { readonly kg: number; readonly bodyweight: boolean };

/** One sheet row of the next session (all its sets share these values). */
export type ExerciseView = {
  readonly key: string; // stable per sheet row, for the local "done" state
  readonly name: string;
  readonly type: string;
  readonly setsText: string | null;
  readonly repsText: string | null;
  readonly prescribed: string | null;
  readonly bodyweight: boolean;
  readonly reference: Reference | null; // last week's logged kg for the same sheet row
};

/** The next session to do: session k + 1 of this ISO week. It has no date until it's done. */
export type StrengthSession = {
  readonly session: number; // n
  readonly of: number; // N, sessions the sheet prescribes this ISO week
  readonly block: string;
  readonly week: number;
  readonly exercises: readonly ExerciseView[]; // sheet order
};

/** A strength activity logged this ISO week (the n-th is session n). */
export type DoneSession = {
  readonly session: number;
  readonly extra: boolean; // beyond the sheet's sessions: "not in the program", 0 TSS
  readonly date: IsoDate;
  readonly isToday: boolean;
  readonly activityName: string | null;
  readonly movingTimeS: number | null;
};

/**
 * This ISO week's strength, per the rule "the n-th strength activity of the week is session
 * n": k = activities so far, N = sessions the sheet prescribes. Nothing comes from weekdays.
 *   next        k < N: `next` is session k + 1
 *   all_done    k >= N > 0
 *   no_program  N = 0
 */
export type StrengthWeek = {
  readonly state: "next" | "all_done" | "no_program";
  readonly isoWeek: number;
  readonly planned: number; // N
  readonly done: readonly DoneSession[]; // k, in session order
  readonly next: StrengthSession | null; // set only in state "next"
  readonly nextWeekStart: IsoDate; // the Monday next week's session 1 shows from
};

export type RideView = {
  readonly name: string;
  readonly notes: string | null;
  readonly ftp: number | null;
  readonly totalMinutes: number;
  readonly steps: readonly PlanItem[];
  readonly problem: string | null;
};

/** The first date after today (within the lookahead) with a planned ride, and its rides. */
export type NextDay = {
  readonly date: IsoDate;
  readonly isTomorrow: boolean;
  readonly rides: readonly string[]; // planned ride names
};

export type TodayHeader = {
  readonly date: IsoDate; // the daily_load row's date (normally today)
  readonly tsb: number;
  readonly zone: Hero["zone"];
  readonly freshness: Freshness;
};

/**
 * The day's plan. The form line (TodayHeader) is built and loaded separately.
 * kind: "strength" when a session is left this week (state "next"), "ride" when a ride is
 * planned today, "both", or "rest" (no ride today and no session left: the Rest card shows).
 */
export type TodayPlan = {
  readonly date: IsoDate;
  readonly kind: "strength" | "ride" | "both" | "rest";
  readonly strength: StrengthWeek;
  readonly doneToday: boolean; // a strength activity was logged today
  readonly rides: readonly RideView[];
  readonly next: NextDay | null; // next planned ride; null when none within the lookahead
};

function rowKey(s: { readonly block: string; readonly sheetRow: number }): string {
  return `${s.block}#${s.sheetRow}`;
}

/** Last week's logged kg per sheet row; nothing logged (0 kg) is no reference. */
function references(previous: readonly PrescribedSetRow[]): Map<string, Reference> {
  const refs = new Map<string, Reference>();
  for (const s of previous) {
    if (s.loggedKg !== null && s.loggedKg > 0 && !refs.has(rowKey(s))) {
      refs.set(rowKey(s), { kg: s.loggedKg, bodyweight: s.bodyweight });
    }
  }
  return refs;
}

function exercisesOf(sets: readonly PrescribedSetRow[], refs: Map<string, Reference>): ExerciseView[] {
  const rows = new Map<string, ExerciseView>();
  const ordered = sets.toSorted(
    (a, b) => a.block.localeCompare(b.block) || a.sheetRow - b.sheetRow || a.setNo - b.setNo,
  );
  for (const s of ordered) {
    const key = rowKey(s);
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name: s.name,
        type: s.type,
        setsText: s.setsText,
        repsText: s.repsText,
        prescribed: s.prescribed,
        bodyweight: s.bodyweight,
        reference: refs.get(key) ?? null,
      });
    }
  }
  return [...rows.values()];
}

type DoneRow = StrengthSessionRow & { readonly date: IsoDate };

/** This ISO week's strength (see StrengthWeek). Rows of other weeks are ignored. */
export function strengthWeek(data: TodayPlanData, today: IsoDate): StrengthWeek {
  const week = data.sessions.filter((r) => r.weekStart === data.weekStart);
  const planned = week.filter((r) => r.block !== null);
  const done: DoneSession[] = week
    .filter((r): r is DoneRow => r.date !== null)
    .toSorted((a, b) => a.session - b.session)
    .map((r) => ({
      session: r.session,
      extra: r.block === null,
      date: r.date,
      isToday: r.date === today,
      activityName: r.activityName,
      movingTimeS: r.movingTimeS,
    }));
  const base = {
    isoWeek: isoWeekNumber(data.weekStart),
    planned: planned.length,
    done,
    nextWeekStart: addDays(data.weekStart, 7),
  };
  if (planned.length === 0) return { ...base, state: "no_program", next: null };
  const slot = planned.find((r) => r.session === done.length + 1);
  if (slot === undefined || slot.block === null || slot.week === null) {
    return { ...base, state: "all_done", next: null };
  }
  return {
    ...base,
    state: "next",
    next: {
      session: slot.session,
      of: planned.length,
      block: slot.block,
      week: slot.week,
      exercises: exercisesOf(
        data.sets.filter((s) => s.weekStart === data.weekStart && s.session === slot.session),
        references(data.previousWeek),
      ),
    },
  };
}

function nextDay(data: TodayPlanData, today: IsoDate): NextDay | null {
  const dates = data.upcomingRides.map((r) => r.date).filter((d) => d > today);
  if (dates.length === 0) return null;
  const date = dates.reduce((a, b) => (b < a ? b : a));
  const rides = data.upcomingRides.filter((r) => r.date === date).map((r) => r.name);
  return { date, isTomorrow: date === addDays(today, 1), rides };
}

/** The form line from the latest daily_load row (null when there is none). */
export function todayHeader(latest: DailyLoadRow | null, now: Date): TodayHeader | null {
  return latest === null
    ? null
    : {
        date: latest.date,
        tsb: latest.tsb,
        zone: zoneDisplay(latest.formZone),
        freshness: freshness(latest.computedAt, now),
      };
}

export function buildTodayPlan(data: TodayPlanData, today: IsoDate): TodayPlan {
  const strength = strengthWeek(data, today);
  const rides: RideView[] = data.rides.map((r) => ({
    name: r.name,
    notes: r.notes,
    ftp: r.ftp,
    totalMinutes: r.totalMinutes,
    steps: r.steps,
    problem: r.problem,
  }));
  const left = strength.state === "next";
  const kind = left && rides.length > 0 ? "both" : left ? "strength" : rides.length > 0 ? "ride" : "rest";
  const doneToday = strength.done.some((d) => d.isToday);
  return { date: today, kind, strength, doneToday, rides, next: nextDay(data, today) };
}
