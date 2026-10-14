/**
 * Pure view model for the Træning screen (no I/O, no React; tested with `node --test`).
 * It selects and groups what Python stored; it never calculates training numbers
 * (watts, TSB and zones all come from the database).
 */
import { freshness, zoneDisplay } from "./dashboard-view.ts";
import type { Freshness, Hero } from "./dashboard-view.ts";
import { addDays, isoWeek, isoWeekStart } from "./dates.ts";
import type { TrainingPlanData } from "./db/queries.ts";
import type {
  DailyLoadRow,
  IsoDate,
  PlanItem,
  PlannedSetRow,
  PrescribedSetRow,
  RampStep,
  StrengthSessionRow,
  SuggestionBasis,
} from "./db/rows.ts";
import {
  formatClock,
  formatDateRange,
  formatDay,
  formatKg,
  formatSetLoad,
  formatSetsReps,
  updatedText,
  spokenRange,
  spokenSigned,
} from "./format.ts";
import {
  firstOpen,
  isWarmup,
  type LoggedSet,
  progress,
  type Progress,
  sessionOrderWithWarmups,
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
  /** The weekly cap changed Python's suggestion (planned_sets.uncapped_kg set): "(begrænset)". */
  readonly suggestionCapped: boolean;
  /** What Python's rule added after the cap (2.5 / 5), 0 = held; null = no rule (planned_sets). */
  readonly adjustmentKg: number | null;
  readonly adjustmentReason: string | null; // lowercase, shown after a dash, never re-cased
  readonly restMinS: number | null; // recommended rest after a set; null = none shown
  readonly restMaxS: number | null;
  readonly ramp: readonly RampStep[] | null; // a main lift's warm-up ramp (first row of a run)
  readonly notes: string | null; // the coach's NOTES cell as written
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
  /** One per prescribed session of the week, in session order (the week columns, instrument-traening.md §2.2). */
  readonly columns: readonly WeekColumn[];
};

/**
 * A prescribed session of this ISO week for the week columns: its prescribed sets (warm-ups are
 * not sets) and whether it is done (it has a date), the current one (session k + 1), or later.
 */
export type WeekColumn = {
  readonly session: number;
  readonly sets: number;
  readonly status: "done" | "current" | "future";
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
        suggestionCapped: suggestion !== undefined && suggestion.uncappedKg !== null,
        adjustmentKg: suggestion?.adjustmentKg ?? null,
        adjustmentReason: suggestion?.adjustmentReason ?? null,
        restMinS: suggestion?.restMinS ?? null,
        restMaxS: suggestion?.restMaxS ?? null,
        ramp: suggestion?.ramp ?? null,
        notes: s.notes,
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
  const slot = planned.find((r) => r.session === done.length + 1);
  const current = slot !== undefined && slot.block !== null && slot.week !== null ? slot.session : null;
  const thisWeek = data.sets.filter((s) => s.weekStart === data.weekStart);
  const base = {
    isoWeek: isoWeek(data.weekStart).week,
    planned: planned.length,
    done,
    nextWeekStart: addDays(data.weekStart, 7),
    columns: planned
      .toSorted((a, b) => a.session - b.session)
      .map(
        (r): WeekColumn => ({
          session: r.session,
          sets: thisWeek.filter((s) => s.session === r.session).length,
          status: r.date !== null ? "done" : r.session === current ? "current" : "future",
        }),
      ),
  };
  if (planned.length === 0) return { ...base, state: "no_program", next: null };
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
      order: sessionOrderWithWarmups(exercises.flatMap((e) => e.sets.map((ref) => ({ ref, name: e.name })))),
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
  high_risk: "risiko",
  optimal: "optimal",
  grey_zone: "neutral",
  fresh: "frisk",
  transition: "pause",
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

/** Python's suggested kg ("142,5 kg"), or null when there is none. "0 kg" never shows.
 * `capped`: the weekly cap changed it, shown as "(begrænset)" (CAPPED_WORD). */
export type SuggestionView = { readonly kg: string; readonly capped: boolean } | { readonly kg: null };

/** After a suggestion the weekly cap changed (planned_sets.uncapped_kg, user 2026-10-13). */
export const CAPPED_WORD = "(begrænset)";

export function suggestionView(e: Pick<ExerciseView, "suggestedKg" | "suggestionCapped">): SuggestionView {
  if (e.suggestedKg !== null && e.suggestedKg > 0) {
    return { kg: `${formatKg(e.suggestedKg)} kg`, capped: e.suggestionCapped };
  }
  return { kg: null };
}

type AdjustmentFields = Pick<ExerciseView, "suggestedKg" | "suggestionCapped" | "adjustmentKg" | "adjustmentReason">;

/** "+2,5" / "−2,5" (U+2212); null for a hold (0) or no rule. */
function signedKg(kg: number): string {
  return `${kg < 0 ? "\u2212" : "+"}${formatKg(Math.abs(kg))}`;
}

/**
 * The suggestion's adjustment in brackets (fokus-pause.md §5), after "Forslag 87,5 kg":
 *   long  "(+2,5 – de sidste to var lettere)", "(+2,5 – …, begrænset)", "(holdt – …)"
 *   short "(+2,5)", "(holdt)" (the Fokus mini card)
 * Cap only: "(begrænset)". No rule and no cap: null. "0 kg" never shows.
 */
export function adjustmentBrackets(e: AdjustmentFields, form: "long" | "short"): string | null {
  if (e.suggestedKg === null) return null;
  if (e.adjustmentKg !== null && e.adjustmentReason !== null) {
    const head = e.adjustmentKg === 0 ? "holdt" : signedKg(e.adjustmentKg);
    if (form === "short") return `(${head})`;
    const capped = e.suggestionCapped && e.adjustmentKg !== 0 ? ", begrænset" : "";
    return `(${head} – ${e.adjustmentReason}${capped})`;
  }
  return e.suggestionCapped ? CAPPED_WORD : null;
}

/** The spoken adjustment: ", 2,5 kg mere, fordi de sidste to var lettere"; "" without one. */
export function spokenAdjustment(e: AdjustmentFields): string {
  if (e.suggestedKg === null || e.adjustmentKg === null || e.adjustmentReason === null) return "";
  if (e.adjustmentKg === 0) return `, holdt, fordi ${e.adjustmentReason}`;
  const word = e.adjustmentKg > 0 ? "mere" : "mindre";
  return `, ${formatKg(Math.abs(e.adjustmentKg))} kg ${word}, fordi ${e.adjustmentReason}`;
}

/**
 * The Fokus set card's line under the suggestion (§5): "+2,5 kg – de sidste to var lettere",
 * "Holdt – de sidste to var hårdere", "… · begrænset i forhold til sidste uge", or the cap alone
 * "(begrænset) i forhold til sidste uge". `signed` is the 600 part. Null: nothing to say.
 */
export function adjustmentLine(e: AdjustmentFields): { readonly signed: string; readonly rest: string } | null {
  if (e.suggestedKg === null) return null;
  if (e.adjustmentKg !== null && e.adjustmentReason !== null) {
    const signed = e.adjustmentKg === 0 ? "Holdt" : `${signedKg(e.adjustmentKg)} kg`;
    const capped = e.suggestionCapped && e.adjustmentKg !== 0 ? " · begrænset i forhold til sidste uge" : "";
    return { signed, rest: ` – ${e.adjustmentReason}${capped}` };
  }
  return e.suggestionCapped ? { signed: "", rest: `${CAPPED_WORD} i forhold til sidste uge` } : null;
}

/** Last week's logged load: undefined in week 1 (no item), null when nothing was logged. */
export function lastWeekText(e: Pick<ExerciseView, "reference">, week: number): string | null | undefined {
  if (week < 2) return undefined;
  return e.reference === null ? null : formatSetLoad(e.reference.kg, e.reference.bodyweight);
}

/**
 * A range as one figure, as Fokus prints it: "8 - 12" -> "8–12" (en dash, no spaces); a leading
 * minus stays. The same rule as fokus-view's rangeFigure, kept here because fokus-view imports
 * this module (importing it back would be a cycle).
 */
function rangeFigure(text: string): string {
  return text.trim().replace(/(\d)\s*[-–]\s*(?=\d)/g, "$1–");
}

/** The reps cell as written, for speech (spokenRange reads its ranges as "til"). */
function writtenRepsText(e: Pick<ExerciseView, "repsText">): string | null {
  return e.repsText === null ? null : formatSetsReps(null, e.repsText);
}

/** A set's place in its run: "Sæt index af of". */
export type RunPosition = { readonly index: number; readonly of: number };

/**
 * "Sæt n af m" numbers sets across the run (spec traening.md §10 D11): consecutive sheet rows
 * with the same trimmed name count as one exercise, so Bænk's 1 + 1 + 2 sets read 1..4 af 4.
 * Keyed by setKey; a single-row run is numbered as before. Both Træning and Fokus use this.
 */
export function runPositions(
  exercises: readonly Pick<ExerciseView, "name" | "sets">[],
): ReadonlyMap<string, RunPosition> {
  const positions = new Map<string, RunPosition>();
  let i = 0;
  while (i < exercises.length) {
    const name = exercises[i].name.trim();
    let end = i + 1;
    while (end < exercises.length && exercises[end].name.trim() === name) end += 1;
    const refs = exercises.slice(i, end).flatMap((e) => e.sets);
    refs.forEach((ref, n) => positions.set(setKey(ref), { index: n + 1, of: refs.length }));
    i = end;
  }
  return positions;
}

export type SetLineView = {
  readonly ref: SetRef;
  readonly n: number; // 1-based position in its run (same-named consecutive rows, D11)
  readonly of: number; // the run's sets
  readonly state: SetState;
  readonly endedAt: string | null; // a done set's end
  readonly next: boolean; // the first open set of the session (the Næste tag)
};

export type SetGroupView = {
  readonly exercise: ExerciseView;
  readonly closed: boolean; // every set of this group is done or skipped
  readonly isNext: boolean; // holds the first open set (NÆSTE)
  readonly sets: readonly SetLineView[];
};

export type ChecklistView = {
  readonly groups: readonly SetGroupView[];
  readonly progress: Progress;
  readonly segments: readonly SetState[]; // by position in the session's order
  /** The segments with their exercise names (the head barcode's +4px between exercises). */
  readonly bars: readonly { readonly state: SetState; readonly name: string }[];
  readonly first: SetRef | null; // the first open set; null when every set is done or skipped
  /** Where Begynd / Fortsæt writes "begin": the first open entry, an open warm-up included. */
  readonly beginAt: SetRef | null;
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
  // A warm-up is never a tick (fokus-pause.md): an open warm-up points at its set 1.
  const open = firstOpen(order, log);
  const first = open !== null && isWarmup(open) ? { row: open.row, set: 1 } : open;
  const closed = (refs: readonly SetRef[]) => refs.every((r) => stateOf(log.get(setKey(r))) !== "open");
  const holdsNext = (e: ExerciseView) => first !== null && e.sets.some((r) => r.row === first.row && r.set === first.set);
  const runs = runPositions(exercises);
  const groups = exercises.map((e): SetGroupView => {
    return {
      exercise: e,
      closed: closed(e.sets),
      isNext: holdsNext(e),
      sets: e.sets.map((ref, n) => {
        const logged = log.get(setKey(ref));
        const state = stateOf(logged);
        const run = runs.get(setKey(ref));
        return {
          ref,
          n: run?.index ?? n + 1,
          of: run?.of ?? e.sets.length,
          state,
          endedAt: state === "done" ? (logged?.endedAt ?? null) : null,
          next: first !== null && ref.row === first.row && ref.set === first.set,
        };
      }),
    };
  });
  const p = progress(order, log);
  const nameOfRow = new Map(exercises.map((e) => [e.row, e.name]));
  return {
    groups,
    progress: p,
    segments: order.filter((r) => !isWarmup(r)).map((r) => stateOf(log.get(setKey(r)))),
    bars: order
      .filter((r) => !isWarmup(r))
      .map((r) => ({ state: stateOf(log.get(setKey(r))), name: nameOfRow.get(r.row) ?? "" })),
    first,
    beginAt: open,
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
  const reps = writtenRepsText(e);
  const spokenReps = reps === null ? null : spokenRange(reps);
  const load = e.prescribed === null ? null : spokenRange(e.prescribed);
  const what = spokenReps !== null && load !== null ? `${spokenReps} ved ${load}` : (spokenReps ?? load);
  const parts = [e.name.trim(), `sæt ${line.n} af ${line.of}`];
  if (what !== null) parts.push(what);
  const suggestion = suggestionView(e);
  if (suggestion.kg !== null) parts.push(`forslag ${suggestion.kg}${spokenAdjustment(e)}`); // none: nothing said (§8)
  const lastWeek = lastWeekText(e, week);
  if (lastWeek === null) parts.push("intet logget sidste uge");
  else if (lastWeek !== undefined) parts.push(`sidste uge ${lastWeek}`);
  if (line.state === "done") parts.push(line.endedAt !== null ? `udført ${formatClock(line.endedAt)}` : "udført");
  else if (line.state === "skipped") parts.push("sprunget over");
  else if (line.next) parts.push("næste");
  return parts.join(", ");
}

/**
 * The week columns' sr sentence (§2.2): "Ugen: session 1 udført, session 2 i gang med 7 af 24 sæt,
 * session 3 ikke begyndt." The current session is "i gang" once a set is done or skipped.
 */
export function weekSentence(columns: readonly WeekColumn[], current: readonly SetState[] | null): string {
  const parts = columns.map((c) => {
    if (c.status === "done") return `session ${c.session} udført`;
    const states = c.status === "current" ? (current ?? []) : [];
    if (states.every((s) => s === "open")) return `session ${c.session} ikke begyndt`;
    return `session ${c.session} i gang med ${states.filter((s) => s === "done").length} af ${c.sets} sæt`;
  });
  return `Ugen: ${parts.join(", ")}.`;
}

// --- Træning reset (design/specs/reset-traening.md): captions, the "I dag" summary, the Uge list ---

/** "ons. 14. okt." -> "ons 14": the InverseCard's day ("I DAG · ONS 14", upper-cased by CSS). */
export function shortDay(date: IsoDate): string {
  return formatDay(date).replace(/\./g, "").split(" ").slice(0, 2).join(" ");
}

/** A ListRow day: "Tir", "Ons" (three letters of the da-DK weekday, capitalised). */
export function weekdayLabel(date: IsoDate): string {
  const day = formatDay(date).slice(0, 3);
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** "Program - blok 12 (offseason)" + 3 -> "Blok 12 · uge 3"; a block without a number stays as written. */
export function blockWeekCaption(block: string, week: number): string {
  const no = /blok\s*(\d+)/i.exec(block);
  return `${no === null ? block : `Blok ${no[1]}`} · uge ${week}`;
}

/**
 * The InverseCard summary's names: the distinct exercise names in sheet order, the first three as
 * written, then "og N øvelser mere". One name: "Squat"; two: "Squat og Bench".
 */
export function exerciseNames(exercises: readonly Pick<ExerciseView, "name">[]): string {
  const names: string[] = [];
  for (const e of exercises) {
    const name = e.name.trim();
    if (name !== "" && !names.includes(name)) names.push(name);
  }
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
  const more = names.length - 3;
  return `${names.slice(0, 3).join(", ")} og ${more} ${more === 1 ? "øvelse" : "øvelser"} mere`;
}

/** "Dødløft, Dips, Pulldown og 3 øvelser mere · 19 sæt" / "… · 7 af 19 sæt udført" once a set is touched. */
export function sessionSummary(
  exercises: readonly Pick<ExerciseView, "name">[],
  progress: { readonly done: number; readonly skipped: number; readonly total: number },
): string {
  const touched = progress.done + progress.skipped > 0;
  const count = touched ? `${progress.done} af ${progress.total} sæt udført` : `${progress.total} sæt`;
  const names = exerciseNames(exercises);
  return names === "" ? count : `${names} · ${count}`;
}

/**
 * The header's mono line after the date: "opdateret 05.00" (today), "opdateret 13. okt. 05.00"
 * (an earlier day), "forældet · opdateret 13. okt. 05.00" (stale), "opdatering ukendt".
 */
export function updatedCaption(freshness: Freshness, today: IsoDate): string {
  if (freshness.kind === "unknown") return "opdatering ukendt";
  const at = updatedText(freshness.computedAt, today);
  const when = at.sameDay === true ? at.time : `${at.date} ${at.time}`;
  return `${freshness.kind === "stale" ? "forældet · " : ""}opdateret ${when}`;
}

/** The ISO week of `today` as a caption: "12.–18. okt.". */
export function weekRange(today: IsoDate): string {
  const monday = isoWeekStart(today);
  return formatDateRange(monday, addDays(monday, 6));
}

// --- Træning's Sæt card per exercise (user 2026-10-14, slice exercise-collapse) ---------------

/**
 * One sheet row's prescription in compact form: "1 × 3 @6", "2 × 5 -12.5%", "3 × 6–10 @7–8". The
 * set count is the row's ticks; reps and the load cell keep the sheet's words (ranges as one
 * figure), only a leading "RPE " becomes "@". Null when the row has neither reps nor a load cell.
 */
export function compactPrescription(e: Pick<ExerciseView, "sets" | "repsText" | "prescribed">): string | null {
  const reps = e.repsText === null || e.repsText.trim() === "" ? null : rangeFigure(e.repsText);
  const load = e.prescribed === null || e.prescribed.trim() === "" ? null : rangeFigure(e.prescribed).replace(/^RPE\s*/i, "@");
  if (reps === null && load === null) return null;
  const head = reps === null ? `${e.sets.length} sæt` : `${e.sets.length} × ${reps}`;
  return load === null ? head : `${head} ${load}`;
}

/** One dot per set of an exercise: its state, and whether it is the NÆSTE set. */
export type SetDot = { readonly key: string; readonly state: SetState; readonly next: boolean };

/** An exercise = a run of consecutive sheet rows with the same trimmed name (as runPositions counts them). */
export type ExerciseRunView = {
  readonly key: string; // the run's first row key
  readonly name: string;
  readonly groups: readonly SetGroupView[]; // its sheet rows, sheet order
  readonly prescription: string; // the rows' compact prescriptions joined " · " ("" when none)
  /** The row whose suggestion and last week the head shows: the NÆSTE row, else the first open one, else the first. */
  readonly focus: ExerciseView;
  readonly dots: readonly SetDot[];
  readonly done: number;
  readonly skipped: number;
  readonly total: number;
  readonly isNext: boolean; // holds the session's first open set
  readonly closed: boolean; // every set is done or skipped
};

/** The checklist's groups folded into exercises (runs of the same name), sheet order kept. */
export function exerciseRuns(groups: readonly SetGroupView[]): readonly ExerciseRunView[] {
  const runs: SetGroupView[][] = [];
  for (const g of groups) {
    const last = runs.at(-1);
    if (last !== undefined && last[0].exercise.name.trim() === g.exercise.name.trim()) last.push(g);
    else runs.push([g]);
  }
  return runs.map((run): ExerciseRunView => {
    const lines = run.flatMap((g) => g.sets);
    const focus = run.find((g) => g.isNext) ?? run.find((g) => !g.closed) ?? run[0];
    return {
      key: run[0].exercise.key,
      name: run[0].exercise.name.trim(),
      groups: run,
      prescription: run
        .map((g) => compactPrescription(g.exercise))
        .filter((p): p is string => p !== null)
        .join(" · "),
      focus: focus.exercise,
      dots: lines.map((l) => ({ key: setKey(l.ref), state: l.state, next: l.next })),
      done: lines.filter((l) => l.state === "done").length,
      skipped: lines.filter((l) => l.state === "skipped").length,
      total: lines.length,
      isNext: run.some((g) => g.isNext),
      closed: run.every((g) => g.closed),
    };
  });
}

/** The exercise row's sr count: "2 af 4 sæt udført", ", 1 sprunget over" when any. */
export function runCountText(run: Pick<ExerciseRunView, "done" | "skipped" | "total">): string {
  const base = `${run.done} af ${run.total} sæt udført`;
  return run.skipped > 0 ? `${base}, ${run.skipped} sprunget over` : base;
}
