/**
 * Pure view model for Fokus (`/fokus`, spec design/specs/traening.md §4): which view shows, and
 * every text it shows. No React, no I/O; tested with `node --test` (tests/fokus-view.test.ts).
 * It formats what Python stored and what the set log says; it never computes a training number
 * (the rest timer is a clock: now − the last done tap).
 */
import type { Freshness } from "./dashboard-view.ts";
import { formatKg, formatSetLoad, formatTimeOfDay, formatUpdatedAt, spokenRange } from "./format.ts";
import type { ExerciseCategoryRow, SuggestionBasis } from "./db/rows.ts";
import {
  firstOpen,
  isWarmup,
  type LastTap,
  lastTap,
  type LoggedSet,
  type Progress,
  restStart,
  setKey,
  type SetRef,
  stateOf,
} from "./set-taps.ts";
import {
  CAPPED_WORD,
  type ExerciseView,
  type Reference,
  runPositions,
  spokenAdjustment,
} from "./training-view.ts";

/** What Fokus needs of one sheet row (a subset of ExerciseView, so fixtures stay small). */
export type FokusExercise = Pick<
  ExerciseView,
  | "name"
  | "repsText"
  | "prescribed"
  | "bodyweight"
  | "reference"
  | "row"
  | "suggestedKg"
  | "suggestionBasis"
  | "suggestionCapped"
  | "adjustmentKg"
  | "adjustmentReason"
  | "restMinS"
  | "restMaxS"
  | "ramp"
  | "notes"
  | "sets"
> & {
  /** This week's sheet kg (ExerciseView.kg): never shown (D3); only the finished signature's bar height reads it. */
  readonly kg?: number | null;
};

/**
 * The view states (traening.md §4.5, fokus-pause.md §2–§4):
 *   set       the first open set (Udført, Spring over)
 *   pause     Variant B: the latest tap was a done of a set and the next open set is a set of the
 *             same run (unless "Til næste sæt" dismissed it: `dismissed` holds that rest start)
 *   warmup    Variants A and C: the first open item is a warm-up. `feel` is the set whose done
 *             ended the previous exercise (C), null after a begin, a skip or a dismissed rest (A)
 *   finished  no open set; `feel` is the session's last set when the latest tap was its done
 */
export type FokusView =
  | { readonly kind: "set"; readonly current: SetRef }
  | { readonly kind: "pause"; readonly since: string; readonly done: SetRef; readonly next: SetRef }
  | { readonly kind: "warmup"; readonly warmup: SetRef; readonly since: string | null; readonly feel: SetRef | null }
  | { readonly kind: "finished"; readonly feel: SetRef | null };

export function fokusView(
  order: readonly SetRef[],
  log: ReadonlyMap<string, LoggedSet>,
  dismissed: string | null,
): FokusView {
  const open = firstOpen(order, log);
  const since = restStart(log);
  const latest = lastTap(log);
  const done = since !== null && since !== dismissed && latest !== null ? latest.ref : null;
  if (open === null) return { kind: "finished", feel: since !== null && latest !== null ? latest.ref : null };
  if (isWarmup(open)) {
    return { kind: "warmup", warmup: open, since: log.get(setKey(open))?.startedAt ?? null, feel: done };
  }
  if (since !== null && done !== null) return { kind: "pause", since, done, next: open };
  return { kind: "set", current: open };
}

/** One set in context: its sheet row, "Sæt n af m" numbered across the run (spec §10 D11). */
export type SetInContext = {
  readonly exercise: FokusExercise;
  readonly ref: SetRef;
  readonly number: number; // n, position in the run (same-named consecutive rows)
  readonly count: number; // m, the run's sets
};

export function setInContext(exercises: readonly FokusExercise[], ref: SetRef): SetInContext | null {
  const exercise = exercises.find((e) => e.row === ref.row);
  if (exercise === undefined) return null;
  const run = runPositions(exercises).get(setKey(ref));
  if (run !== undefined) return { exercise, ref, number: run.index, count: run.of };
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

/** Last week's load as words: "140 kg", "kropsvægt", "kropsvægt + 10 kg". */
export function referenceText(reference: Reference): string {
  return formatSetLoad(reference.kg, reference.bodyweight) ?? `${formatKg(reference.kg)} kg`;
}

/**
 * The set card's kg block (§4.2.4). `figure` is the 56px part, `unit` the 32px " kg" after it
 * (null when the figure carries no kg, e.g. "kropsvægt"). italic = computed by the app.
 *   suggestion  label Forslag, the suggestion, italic
 *   last_week   no suggestion: label Sidste uge, last week's kg upright
 * Neither: null, and the block is not shown (round 3: "intet forslag" shows nothing).
 */
export type KgBlock =
  | {
      readonly kind: "suggestion";
      readonly label: "Forslag";
      readonly figure: string;
      readonly unit: "kg";
      readonly capped: boolean; // the weekly cap changed it: "(begrænset)"
    }
  | {
      readonly kind: "last_week";
      readonly label: "Sidste uge";
      readonly figure: string;
      readonly unit: "kg" | null;
    };

export function kgBlock(e: FokusExercise): KgBlock | null {
  if (e.suggestedKg !== null) {
    return { kind: "suggestion", label: "Forslag", figure: formatKg(e.suggestedKg), unit: "kg", capped: e.suggestionCapped };
  }
  if (e.reference !== null) {
    const words = referenceText(e.reference);
    const withKg = words.endsWith(" kg");
    return {
      kind: "last_week",
      label: "Sidste uge",
      figure: withKg ? words.slice(0, -" kg".length) : words,
      unit: withKg ? "kg" : null,
    };
  }
  return null;
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

/** A tap's time of day in Copenhagen: "2026-10-12T16:42:05Z" -> "18.42". */
export function clockTime(iso: string): string {
  return formatTimeOfDay(iso);
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

/** The top bar's skipped part, spoken after the count: ", 1 sprunget over"; null without skips. */
export function skippedText(p: Progress): string | null {
  return p.skipped > 0 ? `, ${p.skipped} sprunget over` : null;
}

/** Fortryd's spoken context (round 3, sr-only): "Squat, sæt 1 udført kl. 18.42" / "Squat, sæt 2 sprunget over". */
export function lastTapText(exercises: readonly FokusExercise[], tap: LastTap): string | null {
  const s = setInContext(exercises, tap.ref);
  if (s === null) return null;
  const name = exerciseName(s.exercise);
  if (isWarmup(tap.ref)) return `${name}, opvarmning færdig kl. ${clockTime(tap.at)}`;
  return tap.kind === "done"
    ? `${name}, sæt ${s.number} udført kl. ${clockTime(tap.at)}`
    : `${name}, sæt ${s.number} sprunget over`;
}

/** Save failed (§6): "1 sæt er ikke gemt." / "3 sæt er ikke gemt." */
export function unsavedText(n: number): string {
  return `${n} sæt er ikke gemt.`;
}

/** The spoken suggestion: "forslag 82,5 kg (begrænset) …" or "intet forslag" (status sentences only). */
function suggestionWords(e: FokusExercise): string {
  if (e.suggestedKg === null) return "intet forslag";
  return `forslag ${formatKg(e.suggestedKg)} kg${e.suggestionCapped ? ` ${CAPPED_WORD}` : ""}${spokenAdjustment(e)}`;
}

/**
 * The next-set block (round 3): line 1 "Squat · sæt 2 af 2" (in a warm-up, whose heading names
 * the exercise: "Sæt 1 af 4"); line 2 "5 reps · RPE 7" and `kg`: the suggestion, else last week's
 * logged kg ("kropsvægt + 10 kg"), else null (nothing shown). `kg.source` is its sr-only prefix.
 */
export type NextKg = { readonly source: "forslag" | "sidste uge"; readonly text: string };

export function nextSetSummary(
  s: SetInContext,
  inWarmup = false,
): { readonly title: string; readonly line: string; readonly kg: NextKg | null } {
  const e = s.exercise;
  const parts: string[] = [];
  if (e.repsText !== null) {
    const word = repsWord(e.repsText);
    parts.push(word === null ? e.repsText : `${e.repsText} ${word}`);
  }
  if (e.prescribed !== null) parts.push(e.prescribed);
  const kg: NextKg | null =
    e.suggestedKg !== null
      ? { source: "forslag", text: `${formatKg(e.suggestedKg)}\u00a0kg` }
      : e.reference !== null
        ? { source: "sidste uge", text: referenceText(e.reference).replace(/ kg$/, "\u00a0kg") }
        : null;
  const title = inWarmup ? `Sæt ${s.number} af ${s.count}` : `${exerciseName(e)} · sæt ${s.number} af ${s.count}`;
  return { title, line: parts.join(" · "), kg };
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
  parts.push(suggestionWords(e));
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

/**
 * A begin with nothing done or skipped (fokus-pause.md §1, §6): the warm-up it started, for the
 * last-tap line "Begyndt kl. 17.58" and a Fortryd that removes it. Null otherwise.
 */
export function begunWarmup(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): { readonly ref: SetRef; readonly at: string } | null {
  if (lastTap(log) !== null) return null;
  const first = firstOpen(order, log);
  const started = first === null ? null : (log.get(setKey(first))?.startedAt ?? null);
  return first !== null && isWarmup(first) && started !== null ? { ref: first, at: started } : null;
}

export function begunText(at: string): string {
  return `Begyndt kl. ${clockTime(at)}`;
}

/** The set a warm-up comes before (its set 1). */
export function setOneOf(warmup: SetRef): SetRef {
  return { row: warmup.row, set: 1 };
}

/** "Opvarmning · Squat". */
export function warmupTitle(e: FokusExercise): string {
  return `Opvarmning · ${exerciseName(e)}`;
}

/**
 * The ramp's basis line (§2.3): Python's ramp is 40/60/80 % of the first working set's kg, which
 * is the suggestion when there is one, else last week's logged kg. The web never computes it.
 */
export function rampBasis(e: FokusExercise): string | null {
  if (e.ramp === null) return null;
  if (e.suggestedKg !== null) return `Op mod forslaget ${formatKg(e.suggestedKg)} kg`;
  if (e.reference !== null) return `Op mod sidste uge ${referenceText(e.reference)}`;
  return null;
}

/** A catalogue key: trimmed, case-insensitive (as lib/db/set-log.ts and public.exercises' lower(btrim(name))). */
function catalogueKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The name and alias keys of the catalogue's main lifts (category "main"), matched as the server
 * matches: a canonical name wins over another exercise's alias. A failed read (null) is null.
 */
export function mainLiftKeys(rows: readonly Pick<ExerciseCategoryRow, "name" | "aliases" | "category">[] | null): string[] | null {
  if (rows === null) return null;
  const category = new Map<string, ExerciseCategoryRow["category"]>();
  for (const r of rows) if (!category.has(catalogueKey(r.name))) category.set(catalogueKey(r.name), r.category);
  for (const r of rows) for (const a of r.aliases) if (!category.has(catalogueKey(a))) category.set(catalogueKey(a), r.category);
  return [...category].filter(([, c]) => c === "main").map(([k]) => k);
}

/**
 * A main lift: a ramp is present, else the catalogue says category "main". An unknown name, or
 * an unread catalogue (null), is not a main lift, so its warm-up shows the timer only.
 */
export function isMainLift(e: Pick<FokusExercise, "name" | "ramp">, mainKeys: readonly string[] | null): boolean {
  if (e.ramp !== null) return true;
  return mainKeys !== null && mainKeys.includes(catalogueKey(e.name));
}

/** Fortryd of "Begynd træning" goes back to Træning with this query (fokus-pause.md §6). */
export const BEGIN_UNDONE_HREF = "/?fortrudt=begin";
export const BEGIN_UNDONE_TEXT = "Fortrudt: træningen er ikke begyndt.";

/** Træning was opened by Fortryd of "Begynd træning" (`location.search`). */
export function beginUndone(search: string): boolean {
  return new URLSearchParams(search).get("fortrudt") === "begin";
}

/** Main lifts get a ramp or its absence; accessories nothing (timer only). */
export function rampState(e: FokusExercise, mainLift: boolean): "ramp" | "none" | "hidden" {
  if (e.ramp !== null && e.ramp.length > 0) return "ramp";
  return mainLift ? "none" : "hidden";
}

/** The ramp in the status sentence: "5 reps 57,5 kg, 3 reps 85 kg, 2 reps 115 kg". */
export function spokenRamp(e: FokusExercise): string | null {
  if (e.ramp === null || e.ramp.length === 0) return null;
  return e.ramp.map((r) => `${r.reps} reps ${formatKg(r.kg)} kg`).join(", ");
}

/** A range reps cell ("6 - 10", "8-12", "6–10") as its bounds; null for a fixed count or text. */
export function repsRange(repsText: string | null): { readonly low: number; readonly top: number } | null {
  const m = repsText === null ? null : /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(repsText);
  if (m === null) return null;
  const low = Number(m[1]);
  const top = Number(m[2]);
  return top > low ? { low, top } : null;
}

/** The reps stepper (§1.1): 1 to top + 10; the value shown is the log's, else the range top
 * (the server stores the top at Udført, so the default is the stored value after a reload). */
export function stepperBounds(top: number): { readonly min: number; readonly max: number } {
  return { min: 1, max: top + 10 };
}

export function stepperValue(logged: number | null | undefined, top: number): number {
  const { min, max } = stepperBounds(top);
  return logged == null ? top : Math.min(max, Math.max(min, logged));
}

/** Seconds as the band's minutes: 180 -> "3", 90 -> "1½", 150 -> "2½". */
export function restMinutes(seconds: number): string {
  const halves = Math.round(seconds / 30);
  const whole = Math.floor(halves / 2);
  if (halves % 2 === 0) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/** The pause's state against the recommended rest (§3.4): announced once at min and at max (round 3: no visible line). */
export type RestBand = { readonly kind: "none" | "before" | "ready" | "over" };

export function restBand(seconds: number, minS: number | null, maxS: number | null): RestBand {
  if (minS === null || maxS === null) return { kind: "none" };
  if (seconds < minS) return { kind: "before" };
  if (seconds <= maxS) return { kind: "ready" };
  return { kind: "over" };
}

/** The rest rail (§3.3): the scale runs to 1.2 × max; fill, min tick and max tick as fractions. */
export function restRail(seconds: number, minS: number, maxS: number): { readonly fill: number; readonly min: number; readonly max: number } {
  const scale = 1.2 * maxS;
  return { fill: Math.min(1, Math.max(0, seconds / scale)), min: minS / scale, max: maxS / scale };
}

/** "Anbefalet pause nået: 3 minutter. Klar til næste sæt." / "Pausen er over 5 minutter." */
export function restSentence(band: RestBand, minS: number | null, maxS: number | null): string | null {
  if (band.kind === "ready" && minS !== null) return `Anbefalet pause nået: ${spokenMinutes(minS)}. Klar til næste sæt.`;
  if (band.kind === "over" && maxS !== null) return `Pausen er over ${spokenMinutes(maxS)}.`;
  return null;
}

function spokenMinutes(seconds: number): string {
  const m = restMinutes(seconds).replace("½", ",5");
  return m === "1" ? "1 minut" : `${m.startsWith(",") ? "0" + m : m} minutter`;
}

/** "Squat, sæt 2 udført. Pause, anbefalet 3 til 5 minutter. Hvordan var sæt 2?" */
export function pauseSentence(s: SetInContext): string {
  const e = s.exercise;
  const rest =
    e.restMinS !== null && e.restMaxS !== null
      ? `Pause, anbefalet ${restMinutes(e.restMinS).replace("½", ",5")} til ${restMinutes(e.restMaxS).replace("½", ",5")} minutter.`
      : "Pause.";
  return `${exerciseName(e)}, sæt ${s.number} udført. ${rest} ${feelQuestion(s, false)}`;
}

/** "Squat, sæt 4 udført. Opvarmning, Bænkpres: 5 reps 57,5 kg, 3 reps 85 kg, 2 reps 115 kg." */
export function warmupSentence(done: SetInContext | null, next: FokusExercise): string {
  const ramp = spokenRamp(next);
  const head = done === null ? "" : `${exerciseName(done.exercise)}, sæt ${done.number} udført. `;
  return `${head}Opvarmning, ${exerciseName(next)}${ramp === null ? "." : `: ${ramp}.`}`;
}

/** "Hvordan var sæt 2?" / "Hvordan var sæt 4 i Squat?" (when the card below names another exercise). */
export function feelQuestion(s: SetInContext, named: boolean): string {
  return named ? `Hvordan var sæt ${s.number} i ${exerciseName(s.exercise)}?` : `Hvordan var sæt ${s.number}?`;
}

export const FEEL_OPTIONS: readonly { readonly value: -1 | 0 | 1; readonly label: string }[] = [
  { value: -1, label: "Lettere" },
  { value: 0, label: "Som ventet" },
  { value: 1, label: "Hårdere" },
];

/** A feel tap: the chosen option again clears it (null), another overwrites. */
export function nextFeel(current: number | null | undefined, chosen: -1 | 0 | 1): -1 | 0 | 1 | null {
  return current === chosen ? null : chosen;
}

/**
 * The footer (§1.3): "Tid brugt 42 min · ca. 31 min tilbage". Display timing computed in the
 * browser from today's log (like the rest timer), never stored and never a training number:
 * elapsed = now − the session's first start (warm-up or set); remaining = open sets × the mean
 * span (end − start) of today's done sets, from 2 done sets. Null before the first start.
 */
export function footerText(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>, now: number): string | null {
  const starts = [...log.values()].flatMap((l) => (l.startedAt === null ? [] : [Date.parse(l.startedAt)]));
  if (starts.length === 0) return null;
  const elapsed = `Tid brugt ${Math.max(0, Math.floor((now - Math.min(...starts)) / 60_000))} min`;
  const spans = [...log.values()].flatMap((l) =>
    isWarmup(l) || l.skipped || l.startedAt === null || l.endedAt === null
      ? []
      : [Date.parse(l.endedAt) - Date.parse(l.startedAt)],
  );
  if (spans.length < 2) return elapsed;
  const open = order.filter((r) => !isWarmup(r) && stateOf(log.get(setKey(r))) === "open").length;
  if (open === 0) return elapsed;
  const mean = spans.reduce((a, b) => a + b, 0) / spans.length;
  return `${elapsed} · ca. ${durationText(Math.round((open * mean) / 60_000))} tilbage`;
}

/** 31 -> "31 min", 65 -> "1 t 5 min", 60 -> "1 t". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} t` : `${h} t ${m} min`;
}

/** Notes up to this many characters show in full; longer ones clamp to 2 lines with "Hele noten". */
export const NOTE_CLAMP_CHARS = 60;

/** A range as one figure (round 4): "8 - 12" -> "8–12" (en dash, no spaces); a leading minus stays. */
export function rangeFigure(text: string): string {
  return text.trim().replace(/(\d)\s*[-–]\s*(?=\d)/g, "$1–");
}

/**
 * The set view's middle column (fokus-round4.md §2): "RPE 7-8" -> RPE "7–8"; "-12.5%" -> PROCENT
 * "-12.5" + a small "%", as written. No cell: null (the column is absent). Any other text is shown
 * as written under no caption (never relabelled as an RPE).
 */
export type PrescribedCell = { readonly caption: "RPE" | "Procent" | null; readonly value: string; readonly unit: "%" | null };

export function prescribedCell(prescribed: string | null): PrescribedCell | null {
  if (prescribed === null || prescribed.trim() === "") return null;
  const rpe = /^\s*RPE\s*(.+?)\s*$/i.exec(prescribed);
  if (rpe !== null) return { caption: "RPE", value: rangeFigure(rpe[1]), unit: null };
  const pct = /^\s*(.+?)\s*%\s*$/.exec(prescribed);
  if (pct !== null) return { caption: "Procent", value: rangeFigure(pct[1]), unit: "%" };
  return { caption: null, value: prescribed.trim(), unit: null };
}
