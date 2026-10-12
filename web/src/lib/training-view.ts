/**
 * Pure view model for the Træning screen (no I/O, no React; tested with `node --test`).
 * It selects and groups what Python stored; it never calculates training numbers
 * (watts, TSB and zones all come from the database).
 */
import { freshness, zoneDisplay } from "./dashboard-view.ts";
import type { Freshness, Hero } from "./dashboard-view.ts";
import { addDays, isoWeekNumber } from "./dates.ts";
import type { TrainingPlanData } from "./db/queries.ts";
import type {
  DailyLoadRow,
  IsoDate,
  PlanItem,
  PlannedSetRow,
  PrescribedSetRow,
  StrengthSessionRow,
  SuggestionBasis,
} from "./db/rows.ts";
import { formatClock, formatKg, formatSetLoad, formatSetsReps, spokenRange, spokenSigned } from "./format.ts";
import {
  firstOpen,
  type LoggedSet,
  progress,
  type Progress,
  sessionOrder,
  setKey,
  type SetRef,
  type SetState,
  stateOf,
} from "./set-taps.ts";
import type { ZoneKey } from "./zone-scale.ts";

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
 * The date the Træning screen shows: the local date, or DEV_TODAY (YYYY-MM-DD) when running
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
  /** This week's kg from the sheet (the user's own number: planned ahead or lifted); null = none. */
  readonly kg: number | null;
  readonly reference: Reference | null; // last week's logged kg for the same sheet row
  readonly row: number; // strength_sets.sheet_row: the set log's row_no
  /** Python's suggested kg for this row's sets (planned_sets; all sets of a row share it). */
  readonly suggestedKg: number | null;
  readonly suggestionBasis: SuggestionBasis | null; // null: no planned_sets row (yet)
  readonly sets: readonly SetRef[]; // this row's sets, 1..n (each has its own tick)
};

/** The next session to do: session k + 1 of this ISO week. It has no date until it's done. */
export type StrengthSession = {
  readonly session: number; // n
  readonly of: number; // N, sessions the sheet prescribes this ISO week
  readonly block: string;
  readonly week: number;
  readonly exercises: readonly ExerciseView[]; // sheet order
  readonly order: readonly SetRef[]; // every set of the session in the sheet's order
  /** The session's logged sets today (exercise_set_log), read back so progress survives a reload. */
  readonly log: readonly LoggedSet[];
  readonly logFailed: boolean; // the log couldn't be read: shown as open, with a warning (§5)
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

export type TrainingHeader = {
  readonly date: IsoDate; // the daily_load row's date (normally today)
  readonly tsb: number;
  readonly zone: Hero["zone"];
  readonly freshness: Freshness;
};

/**
 * The day's plan. The form line (TrainingHeader) is built and loaded separately.
 * kind: "strength" when a session is left this week (state "next"), "ride" when a ride is
 * planned today, "both", or "rest" (no ride today and no session left: the Rest card shows).
 */
export type TrainingPlan = {
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

/** Last week's logged kg per sheet row. Nothing logged (null) is no reference; on a bodyweight
 * exercise 0 is a real entry ("kropsvægt"), on a weighted one the parser already made it null. */
function references(previous: readonly PrescribedSetRow[]): Map<string, Reference> {
  const refs = new Map<string, Reference>();
  for (const s of previous) {
    if (s.loggedKg !== null && (s.loggedKg > 0 || s.bodyweight) && !refs.has(rowKey(s))) {
      refs.set(rowKey(s), { kg: s.loggedKg, bodyweight: s.bodyweight });
    }
  }
  return refs;
}

function plannedKey(s: { readonly block: string; readonly sheetRow: number; readonly week: number; readonly setNo: number }): string {
  return `${s.block}#${s.sheetRow}#${s.week}#${s.setNo}`;
}

function exercisesOf(
  sets: readonly PrescribedSetRow[],
  refs: Map<string, Reference>,
  planned: ReadonlyMap<string, PlannedSetRow>,
): ExerciseView[] {
  const rows = new Map<string, ExerciseView>();
  const ordered = sets.toSorted(
    (a, b) => a.block.localeCompare(b.block) || a.sheetRow - b.sheetRow || a.setNo - b.setNo,
  );
  const setsOf = new Map<string, SetRef[]>();
  for (const s of ordered) {
    const key = rowKey(s);
    setsOf.set(key, [...(setsOf.get(key) ?? []), { row: s.sheetRow, set: s.setNo }]);
    if (!rows.has(key)) {
      const suggestion = planned.get(plannedKey(s));
      rows.set(key, {
        key,
        name: s.name,
        type: s.type,
        setsText: s.setsText,
        repsText: s.repsText,
        prescribed: s.prescribed,
        bodyweight: s.bodyweight,
        kg: s.loggedKg,
        reference: refs.get(key) ?? null,
        row: s.sheetRow,
        suggestedKg: suggestion?.suggestedKg ?? null,
        suggestionBasis: suggestion?.basis ?? null,
        sets: [],
      });
    }
  }
  return [...rows.values()].map((r) => ({ ...r, sets: setsOf.get(r.key) ?? [] }));
}

type DoneRow = StrengthSessionRow & { readonly date: IsoDate };

/** This ISO week's strength (see StrengthWeek). Rows of other weeks are ignored. */
export function strengthWeek(data: TrainingPlanData, today: IsoDate): StrengthWeek {
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
  const sessionSets = data.sets.filter((s) => s.weekStart === data.weekStart && s.session === slot.session);
  const exercises = exercisesOf(
    sessionSets,
    references(data.previousWeek),
    new Map(data.plannedSets.map((p) => [plannedKey(p), p])),
  );
  return {
    ...base,
    state: "next",
    next: {
      session: slot.session,
      of: planned.length,
      block: slot.block,
      week: slot.week,
      exercises,
      order: sessionOrder(exercises.flatMap((e) => e.sets)),
      log: data.setLog.filter((l) => l.date === today && l.session === slot.session),
      logFailed: data.setLogFailed,
    },
  };
}

function nextDay(data: TrainingPlanData, today: IsoDate): NextDay | null {
  const dates = data.upcomingRides.map((r) => r.date).filter((d) => d > today);
  if (dates.length === 0) return null;
  const date = dates.reduce((a, b) => (b < a ? b : a));
  const rides = data.upcomingRides.filter((r) => r.date === date).map((r) => r.name);
  return { date, isTomorrow: date === addDays(today, 1), rides };
}

/** The form line from the latest daily_load row (null when there is none). */
export function trainingHeader(latest: DailyLoadRow | null, now: Date): TrainingHeader | null {
  return latest === null
    ? null
    : {
        date: latest.date,
        tsb: latest.tsb,
        zone: zoneDisplay(latest.formZone),
        freshness: freshness(latest.computedAt, now),
      };
}

export function buildTrainingPlan(data: TrainingPlanData, today: IsoDate): TrainingPlan {
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

// --- Træning overview: header and set list (spec traening.md §3, §6) ------------------------

/** The one-line hint under the TSB flag, per zone (spec §6). Shown as written, no full stop. */
export const TSB_HINT: Readonly<Record<ZoneKey, string>> = {
  high_risk: "Meget træt: forvent at ligge klart under",
  optimal: "Forvent at ligge lidt under",
  grey_zone: "Forvent dit normale niveau",
  fresh: "Frisk: forvent at ligge på niveau eller over",
  transition: "Meget frisk, men fitness er på vej ned",
};

const ZONE_WORD: Readonly<Record<ZoneKey, string>> = {
  high_risk: "høj risiko",
  optimal: "optimal",
  grey_zone: "gråzone",
  fresh: "frisk",
  transition: "overgang",
};

/**
 * The form row's sr-only sentence: "Form minus 24 TSS per dag, optimal. Forvent at ligge lidt
 * under." Without a zone: "Form plus 4 TSS per dag. Zone ikke beregnet." `fromDate` is the
 * spoken date when the row is not today's ("søndag 27. september").
 */
export function formSentence(tsb: number, zone: ZoneKey | null, fromDate?: string): string {
  const value = `Form ${spokenSigned(tsb)} TSS per dag`;
  const parts = [zone === null ? `${value}. Zone ikke beregnet.` : `${value}, ${ZONE_WORD[zone]}. ${TSB_HINT[zone]}.`];
  if (fromDate !== undefined) parts.push(`Tallet er fra ${fromDate}.`);
  return parts.join(" ");
}

/** Why a row has no suggestion (spec §6); a missing planned_sets row has no reason. */
const NO_SUGGESTION: Readonly<Record<Exclude<SuggestionBasis, "rpe_e1rm">, string>> = {
  not_rpe: "Intet forslag til %-sæt",
  no_e1rm: "Intet forslag: ingen e1RM endnu",
  no_lift: "Intet forslag til denne øvelse",
};

/** Python's suggested kg ("142,5 kg"), or the words for its absence. "0 kg" never shows. */
export type SuggestionView = { readonly kg: string } | { readonly kg: null; readonly words: string };

export function suggestionView(e: Pick<ExerciseView, "suggestedKg" | "suggestionBasis">): SuggestionView {
  if (e.suggestedKg !== null && e.suggestedKg > 0) return { kg: `${formatKg(e.suggestedKg)} kg` };
  const basis = e.suggestionBasis;
  return { kg: null, words: basis === null || basis === "rpe_e1rm" ? "Intet forslag" : NO_SUGGESTION[basis] };
}

/** Last week's logged load: undefined in week 1 (no item), null when nothing was logged. */
export function lastWeekText(e: Pick<ExerciseView, "reference">, week: number): string | null | undefined {
  if (week < 2) return undefined;
  return e.reference === null ? null : formatSetLoad(e.reference.kg, e.reference.bodyweight);
}

/** The reps cell with its word, as written: "5 reps", "8 - 12 reps", "1 rep"; null when blank. */
export function repsText(e: Pick<ExerciseView, "repsText">): string | null {
  return e.repsText === null ? null : formatSetsReps(null, e.repsText);
}

export type SetLineView = {
  readonly ref: SetRef;
  readonly n: number; // 1-based position in its sheet row
  readonly of: number;
  readonly state: SetState;
  readonly endedAt: string | null; // a done set's end
  readonly next: boolean; // the first open set of the session (the Næste tag)
};

export type SetGroupView = {
  readonly exercise: ExerciseView;
  readonly showName: boolean; // first group of a run, or the slab group
  readonly nameMuted: boolean; // every set of the run is done or skipped
  readonly closed: boolean; // every set of this group is done or skipped
  readonly slab: boolean; // holds the first open set (NÆSTE)
  readonly dividerBefore: boolean; // between runs, unless the slab touches it
  readonly sets: readonly SetLineView[];
};

export type ChecklistView = {
  readonly groups: readonly SetGroupView[];
  readonly progress: Progress;
  readonly segments: readonly SetState[]; // by position in the session's order
  readonly first: SetRef | null; // the first open set; null when every set is done or skipped
  /** The header's primary action: none touched, some touched, or every set closed. */
  readonly primary: "begin" | "continue" | "finished";
};

/**
 * The strength card's list from the sheet rows and the set log: one group per sheet row, runs of
 * the same trimmed name, the NÆSTE group (the one holding the first open set; skipped sets are not
 * open), and the counts. Pure: the log decides every state, nothing is reordered.
 */
export function checklistView(
  exercises: readonly ExerciseView[],
  order: readonly SetRef[],
  log: ReadonlyMap<string, LoggedSet>,
): ChecklistView {
  const first = firstOpen(order, log);
  const closed = (refs: readonly SetRef[]) => refs.every((r) => stateOf(log.get(setKey(r))) !== "open");
  const isSlab = (e: ExerciseView) => first !== null && e.sets.some((r) => r.row === first.row && r.set === first.set);
  const groups = exercises.map((e, i): SetGroupView => {
    const name = e.name.trim();
    const runStart = i === 0 || exercises[i - 1].name.trim() !== name;
    let start = i;
    while (start > 0 && exercises[start - 1].name.trim() === name) start -= 1;
    let end = i + 1;
    while (end < exercises.length && exercises[end].name.trim() === name) end += 1;
    const slab = isSlab(e);
    return {
      exercise: e,
      showName: runStart || slab,
      nameMuted: closed(exercises.slice(start, end).flatMap((x) => x.sets)),
      closed: closed(e.sets),
      slab,
      dividerBefore: runStart && i > 0 && !slab && !isSlab(exercises[i - 1]),
      sets: e.sets.map((ref, n) => {
        const logged = log.get(setKey(ref));
        const state = stateOf(logged);
        return {
          ref,
          n: n + 1,
          of: e.sets.length,
          state,
          endedAt: state === "done" ? (logged?.endedAt ?? null) : null,
          next: first !== null && ref.row === first.row && ref.set === first.set,
        };
      }),
    };
  });
  const p = progress(order, log);
  return {
    groups,
    progress: p,
    segments: order.map((r) => stateOf(log.get(setKey(r)))),
    first,
    primary: first === null ? "finished" : p.done + p.skipped > 0 ? "continue" : "begin",
  };
}

/** A done set's status: "kl. 18.42". */
export function setStatus(line: Pick<SetLineView, "state" | "endedAt">): string | null {
  if (line.state === "skipped") return "sprunget over";
  return line.state === "done" && line.endedAt !== null ? formatClock(line.endedAt) : null;
}

/**
 * One set line's accessible name (spec §3.3, §6): "Squat, sæt 1 af 2, 5 reps ved RPE 7, forslag
 * 142,5 kg, sidste uge 140 kg" + ", udført kl. 18.42" / ", sprunget over" / ", næste". Sheet
 * ranges are spoken " til "; week 1 has no last-week part.
 */
export function spokenSetLine(e: ExerciseView, week: number, line: SetLineView): string {
  const reps = repsText(e);
  const spokenReps = reps === null ? null : spokenRange(reps);
  const load = e.prescribed === null ? null : spokenRange(e.prescribed);
  const what = spokenReps !== null && load !== null ? `${spokenReps} ved ${load}` : (spokenReps ?? load);
  const parts = [e.name.trim(), `sæt ${line.n} af ${line.of}`];
  if (what !== null) parts.push(what);
  const suggestion = suggestionView(e);
  parts.push(suggestion.kg !== null ? `forslag ${suggestion.kg}` : "intet forslag");
  const lastWeek = lastWeekText(e, week);
  if (lastWeek === null) parts.push("intet logget sidste uge");
  else if (lastWeek !== undefined) parts.push(`sidste uge ${lastWeek}`);
  if (line.state === "done") parts.push(line.endedAt !== null ? `udført ${formatClock(line.endedAt)}` : "udført");
  else if (line.state === "skipped") parts.push("sprunget over");
  else if (line.next) parts.push("næste");
  return parts.join(", ");
}
