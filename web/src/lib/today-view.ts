/**
 * Pure view model for the Today screen (no I/O, no React; tested with `node --test`).
 * It selects and groups what Python stored; it never calculates training numbers
 * (watts, TSB and zones all come from the database).
 */
import { freshness, zoneDisplay } from "./dashboard-view.ts";
import type { Freshness, Hero } from "./dashboard-view.ts";
import type { TodayData } from "./db/queries.ts";
import type { IsoDate, PlanItem, PrescribedSetRow } from "./db/rows.ts";

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

export type NextSession =
  | { readonly kind: "strength"; readonly date: IsoDate; readonly block: string; readonly week: number }
  | { readonly kind: "ride"; readonly date: IsoDate; readonly name: string };

export type TodayHeader = {
  readonly date: IsoDate; // the daily_load row's date (normally today)
  readonly tsb: number;
  readonly zone: Hero["zone"];
  readonly freshness: Freshness;
};

export type TodayView = {
  readonly date: IsoDate;
  readonly kind: "strength" | "ride" | "both" | "rest";
  readonly header: TodayHeader | null; // null when daily_load is empty
  readonly strength: readonly StrengthSession[];
  readonly rides: readonly RideView[];
  readonly next: NextSession | null; // the first session after today
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

export function strengthSessions(data: TodayData): StrengthSession[] {
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

function nextSession(data: TodayData): NextSession | null {
  const strength: NextSession | null =
    data.nextStrength === null
      ? null
      : {
          kind: "strength",
          date: data.nextStrength.date,
          block: data.nextStrength.block,
          week: data.nextStrength.week,
        };
  const ride: NextSession | null =
    data.nextRide === null ? null : { kind: "ride", date: data.nextRide.date, name: data.nextRide.name };
  if (strength === null || ride === null) return strength ?? ride;
  return ride.date < strength.date ? ride : strength;
}

export function buildTodayView(data: TodayData, today: IsoDate, now: Date): TodayView {
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
  const latest = data.latest;
  return {
    date: today,
    kind,
    header:
      latest === null
        ? null
        : {
            date: latest.date,
            tsb: latest.tsb,
            zone: zoneDisplay(latest.formZone),
            freshness: freshness(latest.computedAt, now),
          },
    strength,
    rides,
    next: nextSession(data),
  };
}
