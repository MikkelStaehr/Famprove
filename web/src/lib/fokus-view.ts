/**
 * Pure view model for Fokus (`/fokus`, spec design/specs/traening.md §4): which view shows, and
 * every text it shows. No React, no I/O; tested with `node --test` (tests/fokus-view.test.ts).
 * It formats what Python stored and what the set log says; it never computes a training number
 * (the rest timer is a clock: now − the last done tap).
 */
import type { Freshness } from "./dashboard-view.ts";
import { formatKg, formatSetLoad, formatUpdatedAt, spokenRange } from "./format.ts";
import type { SuggestionBasis } from "./db/rows.ts";
import {
  firstOpen,
  type LastTap,
  type LoggedSet,
  type Progress,
  restStart,
  setKey,
  type SetRef,
} from "./set-taps.ts";
import type { ExerciseView, Reference } from "./training-view.ts";

/** What Fokus needs of one sheet row (a subset of ExerciseView, so fixtures stay small). */
export type FokusExercise = Pick<
  ExerciseView,
  "name" | "repsText" | "prescribed" | "bodyweight" | "reference" | "row" | "suggestedKg" | "suggestionBasis" | "sets"
>;

/**
 * The three view states (§4.5): the set view at the first open set; the rest view when the
 * latest tap was a done and an open set remains (unless "Til næste sæt" dismissed that rest:
 * `dismissed` holds the rest start it dismissed); the finished view when no set is open.
 */
export type FokusView =
  | { readonly kind: "set"; readonly current: SetRef }
  | { readonly kind: "rest"; readonly since: string; readonly next: SetRef }
  | { readonly kind: "finished" };

export function fokusView(
  order: readonly SetRef[],
  log: ReadonlyMap<string, LoggedSet>,
  dismissed: string | null,
): FokusView {
  const open = firstOpen(order, log);
  if (open === null) return { kind: "finished" };
  const since = restStart(log);
  if (since !== null && since !== dismissed) return { kind: "rest", since, next: open };
  return { kind: "set", current: open };
}

/** One set in context: its sheet row, "Sæt n af m". */
export type SetInContext = {
  readonly exercise: FokusExercise;
  readonly ref: SetRef;
  readonly number: number; // n
  readonly count: number; // m, the row's sets
};

export function setInContext(exercises: readonly FokusExercise[], ref: SetRef): SetInContext | null {
  const exercise = exercises.find((e) => e.row === ref.row);
  if (exercise === undefined) return null;
  const i = exercise.sets.findIndex((s) => setKey(s) === setKey(ref));
  return { exercise, ref, number: i === -1 ? ref.set : i + 1, count: exercise.sets.length };
}

export function setTitle(s: SetInContext): string {
  return `Sæt ${s.number} af ${s.count}`;
}

/** The exercise name as written, trimmed (sheet cells may carry stray spaces). */
export function exerciseName(e: FokusExercise): string {
  return e.name.trim();
}

/**
 * The word after the reps cell: "rep" after "1", "reps" after any other count, nothing after a
 * cell without a digit ("AMRAP" stays as written, never "AMRAP reps").
 */
export function repsWord(repsText: string): string | null {
  if (!/\d/.test(repsText)) return null;
  return repsText.trim() === "1" ? "rep" : "reps";
}

/** Null-basis reasons (§6). A null basis (no planned_sets row yet) has no reason to give. */
export function suggestionReason(basis: SuggestionBasis | null): string | null {
  switch (basis) {
    case "not_rpe":
      return "Intet forslag til %-sæt";
    case "no_e1rm":
      return "Intet forslag: ingen e1RM endnu";
    case "no_lift":
      return "Intet forslag til denne øvelse";
    default:
      return null;
  }
}

/** Last week's load as words: "140 kg", "kropsvægt", "kropsvægt + 10 kg". */
export function referenceText(reference: Reference): string {
  return formatSetLoad(reference.kg, reference.bodyweight) ?? `${formatKg(reference.kg)} kg`;
}

/**
 * The set card's kg block (§4.2.4). `figure` is the 56px part, `unit` the 32px " kg" after it
 * (null when the figure carries no kg, e.g. "kropsvægt"). italic = computed by the app.
 *   suggestion  label Forslag, the suggestion, italic
 *   last_week   no suggestion: label Sidste uge, last week's kg upright, + the reason
 *   none        label Kg, "Intet forslag", + the reason
 */
export type KgBlock =
  | { readonly kind: "suggestion"; readonly label: "Forslag"; readonly figure: string; readonly unit: "kg" }
  | {
      readonly kind: "last_week";
      readonly label: "Sidste uge";
      readonly figure: string;
      readonly unit: "kg" | null;
      readonly reason: string | null;
    }
  | { readonly kind: "none"; readonly label: "Kg"; readonly text: "Intet forslag"; readonly reason: string | null };

export function kgBlock(e: FokusExercise): KgBlock {
  if (e.suggestedKg !== null) {
    return { kind: "suggestion", label: "Forslag", figure: formatKg(e.suggestedKg), unit: "kg" };
  }
  const reason = suggestionReason(e.suggestionBasis);
  if (e.reference !== null) {
    const words = referenceText(e.reference);
    const withKg = words.endsWith(" kg");
    return {
      kind: "last_week",
      label: "Sidste uge",
      figure: withKg ? words.slice(0, -" kg".length) : words,
      unit: withKg ? "kg" : null,
      reason,
    };
  }
  return { kind: "none", label: "Kg", text: "Intet forslag", reason };
}

/**
 * The last-week line under a shown suggestion (§4.2.5): null when the kg block already shows
 * last week (no suggestion). Week 1 has no last week by definition.
 */
export type LastWeekLine =
  | { readonly kind: "kg"; readonly text: string }
  | { readonly kind: "none"; readonly text: "Intet logget sidste uge" }
  | { readonly kind: "week1"; readonly text: "Uge 1 i blokken: ingen sidste uge" };

export function lastWeekLine(e: FokusExercise, week: number): LastWeekLine | null {
  if (e.suggestedKg === null) return null;
  if (week <= 1) return { kind: "week1", text: "Uge 1 i blokken: ingen sidste uge" };
  if (e.reference === null) return { kind: "none", text: "Intet logget sidste uge" };
  return { kind: "kg", text: referenceText(e.reference) };
}

const CLOCK_FORMAT = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Copenhagen",
});

/** A tap's time of day in Copenhagen: "2026-10-12T16:42:05Z" -> "18.42". */
export function clockTime(iso: string): string {
  return CLOCK_FORMAT.format(new Date(iso));
}

/** Whole seconds from `since` to `now`, never negative (a clock a little behind the server's). */
export function elapsedSeconds(since: string, now: number): number {
  const ms = now - Date.parse(since);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

/** The rest timer: "0:07", "1:42", "12:05", "1:02:10". */
export function formatTimer(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The top bar's skipped part: "· 1 sprunget over"; null without skips. */
export function skippedText(p: Progress): string | null {
  return p.skipped > 0 ? `· ${p.skipped} sprunget over` : null;
}

/** "Squat · sæt 1 udført kl. 18.42" / "Squat · sæt 2 sprunget over". */
export function lastTapText(exercises: readonly FokusExercise[], tap: LastTap): string | null {
  const s = setInContext(exercises, tap.ref);
  if (s === null) return null;
  const name = exerciseName(s.exercise);
  return tap.kind === "done"
    ? `${name} · sæt ${s.number} udført kl. ${clockTime(tap.at)}`
    : `${name} · sæt ${s.number} sprunget over`;
}

/** Save failed (§6): "1 sæt er ikke gemt." / "3 sæt er ikke gemt." */
export function unsavedText(n: number): string {
  return `${n} sæt er ikke gemt.`;
}

/** The rest view's next set (§4.3): "Squat · sæt 2 af 2" and "5 reps · RPE 7 · forslag 142,5 kg". */
export function nextSetSummary(s: SetInContext): { readonly title: string; readonly line: string } {
  const e = s.exercise;
  const parts: string[] = [];
  if (e.repsText !== null) {
    const word = repsWord(e.repsText);
    parts.push(word === null ? e.repsText : `${e.repsText} ${word}`);
  }
  if (e.prescribed !== null) parts.push(e.prescribed);
  parts.push(e.suggestedKg === null ? "intet forslag" : `forslag ${formatKg(e.suggestedKg)} kg`);
  return { title: `${exerciseName(e)} · sæt ${s.number} af ${s.count}`, line: parts.join(" · ") };
}

/**
 * The status sentence on entering a set (§4.7):
 * "Squat, sæt 2 af 2: 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg."
 * Ranges are spoken ("8 til 12 reps"); week 1 has no last-week part.
 */
export function setSentence(s: SetInContext, week: number): string {
  const e = s.exercise;
  const reps = e.repsText === null ? null : spokenReps(e.repsText);
  const load = e.prescribed === null ? null : spokenRange(e.prescribed);
  const what = reps !== null && load !== null ? `${reps} ved ${load}` : (reps ?? load);
  const parts: string[] = [];
  if (what !== null) parts.push(what);
  parts.push(e.suggestedKg === null ? "intet forslag" : `forslag ${formatKg(e.suggestedKg)} kg`);
  if (week > 1) parts.push(e.reference === null ? "intet logget sidste uge" : `sidste uge ${referenceText(e.reference)}`);
  return `${exerciseName(e)}, ${setTitle(s).toLowerCase()}: ${parts.join(", ")}.`;
}

function spokenReps(repsText: string): string {
  const word = repsWord(repsText);
  const spoken = spokenRange(repsText);
  return word === null ? spoken : `${spoken} ${word}`;
}

/** "Squat, sæt 1 udført. Pause." */
export function doneSentence(s: SetInContext): string {
  return `${exerciseName(s.exercise)}, sæt ${s.number} udført. Pause.`;
}

/** "Sæt 2 sprunget over." */
export function skipSentence(s: SetInContext): string {
  return `Sæt ${s.number} sprunget over.`;
}

/** "Fortrudt: Squat, sæt 1 er åben igen." */
export function undoSentence(s: SetInContext): string {
  return `Fortrudt: ${exerciseName(s.exercise)}, sæt ${s.number} er åben igen.`;
}

export const FINISHED_SENTENCE = "Sessionen er klaret.";

/** The finish card (§4.4). */
export type FinishCard = {
  readonly title: string; // "Session 2 er klaret"
  readonly counts: string; // "22 af 24 sæt udført · 2 sprunget over" / "Alle 24 sæt udført"
  readonly times: string | null; // "Start kl. 17.58 · sidste sæt kl. 19.10"; a part without a time is omitted
};

export function finishCard(session: number, p: Progress, log: ReadonlyMap<string, LoggedSet>): FinishCard {
  const counts =
    p.skipped > 0 ? `${p.done} af ${p.total} sæt udført · ${p.skipped} sprunget over` : `Alle ${p.total} sæt udført`;
  const starts = [...log.values()].flatMap((l) => (l.startedAt === null ? [] : [l.startedAt]));
  const ends = [...log.values()].flatMap((l) => (l.endedAt === null ? [] : [l.endedAt]));
  const first = earliest(starts);
  const last = latest(ends);
  const parts: string[] = [];
  if (first !== null) parts.push(`Start kl. ${clockTime(first)}`);
  if (last !== null) parts.push(`${parts.length === 0 ? "Sidste" : "sidste"} sæt kl. ${clockTime(last)}`);
  return { title: `Session ${session} er klaret`, counts, times: parts.length === 0 ? null : parts.join(" · ") };
}

function earliest(times: readonly string[]): string | null {
  return times.reduce<string | null>((a, t) => (a === null || Date.parse(t) < Date.parse(a) ? t : a), null);
}

function latest(times: readonly string[]): string | null {
  return times.reduce<string | null>((a, t) => (a === null || Date.parse(t) > Date.parse(a) ? t : a), null);
}

/** Fokus shows staleness only when stale (§5): the WarningLine's sentence, or null when fresh. */
export function fokusStaleNote(f: Freshness): string | null {
  if (f.kind === "fresh") return null;
  if (f.kind === "stale") {
    return `Programmet er sidst opdateret ${formatUpdatedAt(f.computedAt)} og kan være forældet.`;
  }
  return "Opdateringstidspunkt ukendt, så programmet kan være forældet.";
}

/** The no-session note's sentence (§5): the (c) or (d) state's first sentence. */
export function noSessionSentence(state: "all_done" | "no_program", planned: number): string {
  if (state === "no_program") return "Intet styrkeprogram i denne uge.";
  return planned === 1 ? "Ugens session er udført." : `Alle ${planned} sessioner er udført i denne uge.`;
}
