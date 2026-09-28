/**
 * Pure view model for the Today screen (no I/O, no React; tested with `node --test`).
 * It selects and groups what Python stored; it never calculates training numbers
 * (watts, TSB and zones all come from the database).
 */
import { freshness, zoneDisplay } from "./dashboard-view.ts";
import type { Freshness, Hero } from "./dashboard-view.ts";
import { addDays } from "./dates.ts";
import type { TodayPlanData } from "./db/queries.ts";
import type { DailyLoadRow, IsoDate, PlanItem, PrescribedSetRow } from "./db/rows.ts";

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
 * under `next dev` — for looking at other days while developing. Ignored in production.
 */
export function resolveToday(
  now: Date,
  env: Readonly<Record<string, string | undefined>>,
): IsoDate {
  const override = env.DEV_TODAY;
  if (env.NODE_ENV === "development" && override !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return override;
  }
  return localToday(now);
}

export type Reference = { readonly kg: number; readonly bodyweight: boolean };

/** One sheet row of today's session (all its sets share these values). */
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

export type StrengthSession = {
  readonly block: string;
  readonly week: number;
  readonly exercises: readonly ExerciseView[]; // sheet order
};

export type RideView = {
  readonly name: string;
  readonly notes: string | null;
  readonly ftp: number | null;
  readonly totalMinutes: number;
  readonly steps: readonly PlanItem[];
  readonly problem: string | null;
};

export type NextSessionItem =
  | { readonly kind: "strength"; readonly block: string; readonly week: number }
  | { readonly kind: "ride"; readonly name: string };

/** The first date after today (within the lookahead) with something planned, and all of it. */
export type NextDay = {
  readonly date: IsoDate;
  readonly isTomorrow: boolean;
  readonly sessions: readonly NextSessionItem[]; // ride(s) first, then strength
};

export type TodayHeader = {
  readonly date: IsoDate; // the daily_load row's date (normally today)
  readonly tsb: number;
  readonly zone: Hero["zone"];
  readonly freshness: Freshness;
};

/** The day's plan. The form line (TodayHeader) is built and loaded separately. */
export type TodayPlan = {
  readonly date: IsoDate;
  readonly kind: "strength" | "ride" | "both" | "rest";
  readonly strength: readonly StrengthSession[];
  readonly rides: readonly RideView[];
  readonly next: NextDay | null; // null when nothing is planned within the lookahead
};

function rowKey(s: { readonly block: string; readonly sheetRow: number }): string {
  return `${s.block}#${s.sheetRow}`;
}

/** Last week's logged kg per sheet row; nothing logged (0 kg) is no reference. */
function references(previous: readonly PrescribedSetRow[]): Map<string, Reference> {
  const refs = new Map<string, Reference>();
  for (const s of previous) {
    if (s.loggedKg > 0 && !refs.has(rowKey(s))) {
      refs.set(rowKey(s), { kg: s.loggedKg, bodyweight: s.bodyweight });
    }
  }
  return refs;
}

export function strengthSessions(data: TodayPlanData): StrengthSession[] {
  const refs = references(data.previousWeek);
  const sessions = new Map<string, { block: string; week: number; rows: Map<string, ExerciseView> }>();
  const ordered = data.sets.toSorted(
    (a, b) => a.block.localeCompare(b.block) || a.sheetRow - b.sheetRow || a.setNo - b.setNo,
  );
  for (const s of ordered) {
    const sessionKey = `${s.block}#${s.week}`;
    let session = sessions.get(sessionKey);
    if (session === undefined) {
      session = { block: s.block, week: s.week, rows: new Map() };
      sessions.set(sessionKey, session);
    }
    const key = rowKey(s);
    if (!session.rows.has(key)) {
      session.rows.set(key, {
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
  return [...sessions.values()].map(({ block, week, rows }) => ({
    block,
    week,
    exercises: [...rows.values()],
  }));
}

function nextDay(data: TodayPlanData, today: IsoDate): NextDay | null {
  const dates = [
    ...(data.nextStrength === null ? [] : [data.nextStrength.date]),
    ...data.upcomingRides.map((r) => r.date),
  ].filter((d) => d > today);
  if (dates.length === 0) return null;
  const date = dates.reduce((a, b) => (b < a ? b : a));
  const sessions: NextSessionItem[] = data.upcomingRides
    .filter((r) => r.date === date)
    .map((r) => ({ kind: "ride", name: r.name }));
  if (data.nextStrength !== null && data.nextStrength.date === date) {
    sessions.push({ kind: "strength", block: data.nextStrength.block, week: data.nextStrength.week });
  }
  return { date, isTomorrow: date === addDays(today, 1), sessions };
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
  const strength = strengthSessions(data);
  const rides: RideView[] = data.rides.map((r) => ({
    name: r.name,
    notes: r.notes,
    ftp: r.ftp,
    totalMinutes: r.totalMinutes,
    steps: r.steps,
    problem: r.problem,
  }));
  const kind =
    strength.length > 0 && rides.length > 0
      ? "both"
      : strength.length > 0
        ? "strength"
        : rides.length > 0
          ? "ride"
          : "rest";
  return { date: today, kind, strength, rides, next: nextDay(data, today) };
}
