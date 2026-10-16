import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  clockTime,
  doneSentence,
  elapsedSeconds,
  finishCard,
  type FokusExercise,
  fokusStaleNote,
  fokusState,
  formatTimer,
  kgBlock,
  lastTapText,
  lastWeekLine,
  nextSetSummary,
  noSessionSentence,
  repsWord,
  setInContext,
  setSentence,
  setTitle,
  skippedText,
  skipSentence,
  undoSentence,
  unsavedText,
  BEGIN_UNDONE_HREF,
  BEGIN_UNDONE_TEXT,
  beginUndone,
  isMainLift,
  mainLiftKeys,
} from "../src/lib/fokus-view.ts";
import { applyTap, type LoggedSet, progress, setKey, type SetRef } from "../src/lib/set-taps.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));

const SQUAT: FokusExercise = {
  name: "Squat ",
  variant: null,
  variantId: null,
  repsText: "5",
  prescribed: "RPE 7",
  bodyweight: false,
  reference: { kg: 140, bodyweight: false },
  row: 4,
  suggestedKg: 142.5,
  suggestionBasis: "rpe_e1rm",
  suggestionCapped: false,
  adjustmentKg: null,
  adjustmentReason: null,
  restMinS: null,
  restMaxS: null,
  ramp: null,
  todayKg: 142.5,
  todayBasis: "e1rm",
  sets: [
    { row: 4, set: 1 },
    { row: 4, set: 2 },
  ],
};
const PULLDOWN: FokusExercise = {
  name: "Lat pulldowns",
  variant: null,
  variantId: null,
  repsText: "8 - 12",
  prescribed: "-12.5%",
  bodyweight: false,
  reference: null,
  row: 7,
  suggestedKg: null,
  suggestionBasis: "not_rpe",
  suggestionCapped: false,
  adjustmentKg: null,
  adjustmentReason: null,
  restMinS: null,
  restMaxS: null,
  ramp: null,
  todayKg: null,
  todayBasis: null,
  sets: [{ row: 7, set: 1 }],
};
const EXERCISES = [SQUAT, PULLDOWN];
const ORDER: SetRef[] = [
  { row: 4, set: 1 },
  { row: 4, set: 2 },
  { row: 7, set: 1 },
];

const T0 = "2026-10-12T16:00:00.000Z"; // 18.00 in Copenhagen (CEST)
const T1 = "2026-10-12T16:03:00.000Z";
const T2 = "2026-10-12T16:06:00.000Z";

function tapAll(taps: readonly ["begin" | "done" | "skip" | "undo", SetRef, string][]): Map<string, LoggedSet> {
  let log = new Map<string, LoggedSet>();
  for (const [kind, ref, at] of taps) log = applyTap(ORDER, log, kind, ref, at);
  return log;
}

test("fokusState: set view at the first open set before any tap", () => {
  assert.deepEqual(fokusState(ORDER, new Map()), { kind: "set", next: ORDER[0], rest: null, showRest: false, feel: null });
});

test("fokusState: after a done the view is the next set, the rest counting from that tap (no start step)", () => {
  const log = tapAll([["done", ORDER[0], T0]]);
  assert.deepEqual(fokusState(ORDER, log), {
    kind: "set",
    next: ORDER[1],
    rest: { since: T0, after: ORDER[0] },
    showRest: true,
    feel: ORDER[0],
  });
});

test("fokusState: the rest view's primary is a done on next; the next done rests again from its own tap", () => {
  const log = tapAll([["done", ORDER[0], T0]]);
  const view = fokusState(ORDER, log);
  assert.ok(view.kind === "set");
  // The primary taps `done` on view.next: its end is written, the set after it is shown.
  const after = applyTap(ORDER, log, "done", view.next, T1);
  assert.equal(after.get(setKey(ORDER[1]))?.endedAt, T1);
  assert.deepEqual(fokusState(ORDER, after), {
    kind: "set",
    next: ORDER[2],
    rest: { since: T1, after: ORDER[1] },
    showRest: true,
    feel: ORDER[1],
  });
});

test("fokusState: the feel is optional: an unrated done shows the next set, felt_rpe stays null", () => {
  const log = tapAll([["done", ORDER[0], T0]]);
  assert.equal(log.get(setKey(ORDER[0]))?.feltRpe ?? null, null);
  const view = fokusState(ORDER, log);
  assert.equal(view.kind, "set");
  assert.deepEqual(view.kind === "set" ? view.feel : null, ORDER[0]);
});

test("fokusState: a reload (the same log rebuilt) shows the same next-set view", () => {
  const log = tapAll([["done", ORDER[0], T0]]);
  const reloaded = new Map<string, LoggedSet>([...log.values()].map((l) => [setKey(l), { ...l }]));
  assert.deepEqual(fokusState(ORDER, reloaded), fokusState(ORDER, log));
});

test("fokusState: Fortryd after a done shows that set again, the timer counting from the tap before it (F8)", () => {
  const log = tapAll([
    ["done", ORDER[0], T0],
    ["done", ORDER[1], T1],
    ["undo", ORDER[1], T2],
  ]);
  assert.deepEqual(fokusState(ORDER, log), {
    kind: "set",
    next: ORDER[1],
    rest: { since: T0, after: ORDER[0] },
    showRest: true,
    feel: ORDER[0],
  });
});

test("fokusState: a skip as the latest tap shows the next set directly (no rest strip, no feel row)", () => {
  const log = tapAll([
    ["done", ORDER[0], T0],
    ["skip", ORDER[1], T1],
  ]);
  assert.deepEqual(fokusState(ORDER, log), { kind: "set", next: ORDER[2], rest: null, showRest: false, feel: null });
});

test("Til næste sæt is gone from src/ (fokus-flow.md §1)", () => {
  // grep exits 1 when nothing matches: no file named, no error.
  const r = spawnSync("grep", ["-rl", "Til næste sæt", "src"], { cwd: WEB, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), "");
});

test("fokusState: finished when no set is open, also with skips", () => {
  const log = tapAll([
    ["done", ORDER[0], T0],
    ["skip", ORDER[1], T1],
    ["done", ORDER[2], T2],
  ]);
  assert.deepEqual(fokusState(ORDER, log), { kind: "finished", feel: ORDER[2] });
});

test("setInContext: Sæt n af m by the row's sets; unknown row is null", () => {
  const s = setInContext(EXERCISES, { row: 4, set: 2 });
  assert.equal(s?.number, 2);
  assert.equal(s?.count, 2);
  assert.equal(setInContext(EXERCISES, { row: 99, set: 1 }), null);
});

test("formatTimer: m:ss under an hour, h:mm:ss from an hour", () => {
  assert.equal(formatTimer(7), "0:07");
  assert.equal(formatTimer(102), "1:42");
  assert.equal(formatTimer(725), "12:05");
  assert.equal(formatTimer(3730), "1:02:10");
  assert.equal(formatTimer(-3), "0:00");
});

test("elapsedSeconds: whole seconds, never negative", () => {
  assert.equal(elapsedSeconds(T0, Date.parse(T0) + 102_900), 102);
  assert.equal(elapsedSeconds(T0, Date.parse(T0) - 2_000), 0);
  assert.equal(elapsedSeconds("not a time", Date.parse(T0)), 0);
});

test("clockTime: Copenhagen time of day with a dot", () => {
  assert.equal(clockTime("2026-10-12T16:42:05Z"), "18.42");
  assert.equal(clockTime("2026-12-01T04:03:00Z"), "05.03"); // CET
});

test("repsWord: rep after 1, reps after counts, nothing after a cell without a digit", () => {
  assert.equal(repsWord("5"), "reps");
  assert.equal(repsWord("8 - 12"), "reps");
  assert.equal(repsWord(" 1 "), "rep");
  assert.equal(repsWord("AMRAP"), null);
});

/** fokus-kg.md K1–K3: the sheet's rows 77–79 (block 12, week 10), as Python writes them. */
const ROW = (row: number, todayKg: number, todayBasis: "sheet" | "derived", lastKg: number): FokusExercise => ({
  ...SQUAT,
  row,
  suggestedKg: null,
  suggestionBasis: "not_rpe",
  todayKg,
  todayBasis,
  reference: { kg: lastKg, bodyweight: false },
  sets: [{ row, set: 1 }],
});

test("K1–K3: rows 77–79 show I DAG and the Sidste uge line, equal or not", () => {
  const cases = [
    [ROW(77, 142.5, "sheet", 140), "142,5", "140 kg"],
    [ROW(78, 145, "sheet", 145), "145", "145 kg"],
    [ROW(79, 127.5, "sheet", 130), "127,5", "130 kg"],
  ] as const;
  for (const [e, figure, last] of cases) {
    const kg = kgBlock(e);
    assert.equal(kg?.figure, figure);
    assert.equal(kg?.unit, "kg");
    assert.equal(kg?.caption, "I dag");
    assert.equal(kg?.italic, false); // as written in the sheet: upright
    assert.deepEqual(lastWeekLine(e, 10), { kind: "kg", text: last });
  }
  const s = setInContext([cases[0][0]], { row: 77, set: 1 });
  assert.ok(s !== null);
  assert.equal(nextSetSummary(s, false, 10).kg?.text, "142,5\u00a0kg"); // K4: the pause card reads the same
  assert.deepEqual(nextSetSummary(s, false, 10).lastWeek, { kind: "kg", text: "140 kg" });
  assert.equal(setSentence(s, 10), "Squat, sæt 1 af 1: 5 reps ved RPE 7, i dag 142,5 kg, sidste uge 140 kg.");
});

test("kgBlock per basis: derived italic, e1rm ~ italic + cirka, last upright without a Sidste uge line, none null", () => {
  const derived = kgBlock(ROW(79, 127.5, "derived", 130));
  assert.deepEqual(
    [derived?.caption, derived?.figure, derived?.italic, derived?.spoken],
    ["I dag · beregnet", "127,5", true, "i dag 127,5 kg, beregnet"],
  );
  const e1rm = kgBlock(SQUAT);
  assert.deepEqual(
    [e1rm?.caption, e1rm?.figure, e1rm?.italic, e1rm?.spoken],
    ["I dag · skøn", "~142,5", true, "i dag cirka 142,5 kg, et skøn"],
  );
  assert.equal(kgBlock({ ...SQUAT, suggestionCapped: true })?.capped, true);
  const last = { ...SQUAT, todayKg: 140, todayBasis: "last" as const };
  assert.deepEqual([kgBlock(last)?.caption, kgBlock(last)?.figure, kgBlock(last)?.italic], ["Samme som sidst", "140", false]);
  assert.equal(kgBlock(last)?.spoken, "samme som sidst: 140 kg");
  assert.equal(lastWeekLine(last, 3), null); // it would repeat the block
  assert.equal(kgBlock(PULLDOWN), null);
  assert.equal(kgBlock({ ...PULLDOWN, reference: { kg: 60, bodyweight: false } }), null); // no today_kg: no block
});

test("kgBlock: bodyweight reads kropsvægt (no unit) or kropsvægt + 10 kg; never 0 kg", () => {
  const bw = kgBlock({ ...PULLDOWN, bodyweight: true, todayKg: 0, todayBasis: "sheet" });
  assert.deepEqual([bw?.figure, bw?.unit, bw?.spoken], ["kropsvægt", null, "i dag kropsvægt"]);
  const plus = kgBlock({ ...PULLDOWN, bodyweight: true, todayKg: 10, todayBasis: "sheet" });
  assert.deepEqual([plus?.figure, plus?.unit], ["kropsvægt + 10", "kg"]);
});

test("K7: week 1 and nothing logged have no Sidste uge line and no text", () => {
  assert.equal(lastWeekLine(SQUAT, 1), null);
  assert.equal(lastWeekLine({ ...SQUAT, reference: null }, 3), null);
  assert.equal(lastWeekLine(PULLDOWN, 3), null);
});

test("lastTapText (Fortryd's sr-only context): done with its time, skip without", () => {
  assert.equal(
    lastTapText(EXERCISES, { ref: { row: 4, set: 1 }, kind: "done", at: "2026-10-12T16:42:00Z" }),
    "Squat, sæt 1 udført kl. 18.42",
  );
  assert.equal(lastTapText(EXERCISES, { ref: { row: 4, set: 2 }, kind: "skip", at: T1 }), "Squat, sæt 2 sprunget over");
});

test("skippedText and unsavedText", () => {
  assert.equal(skippedText({ done: 7, skipped: 0, total: 24 }), null);
  assert.equal(skippedText({ done: 7, skipped: 1, total: 24 }), ", 1 sprunget over"); // spoken after the count: a comma, not a middle dot
  assert.equal(unsavedText(1), "1 sæt er ikke gemt.");
  assert.equal(unsavedText(3), "3 sæt er ikke gemt.");
});

test("nextSetSummary: today's kg with its caption, and the Sidste uge item", () => {
  const squat2 = setInContext(EXERCISES, { row: 4, set: 2 });
  assert.ok(squat2 !== null);
  assert.deepEqual(nextSetSummary(squat2, false, 2), {
    title: "Squat · sæt 2 af 2",
    exercise: null,
    line: "5 reps · RPE 7",
    kg: { caption: "I dag · skøn", text: "~142,5\u00a0kg", italic: true, spoken: "i dag cirka 142,5 kg, et skøn" },
    lastWeek: { kind: "kg", text: "140 kg" },
  });
});

test("nextSetSummary: no today's kg -> no kg, never 'forslag'", () => {
  const pull = setInContext(EXERCISES, { row: 7, set: 1 });
  assert.ok(pull !== null);
  const summary = nextSetSummary(pull, false, 2);
  assert.equal(summary.line, "8–12 reps · -12.5%"); // ranges as the set view writes them (rangeFigure)
  assert.equal(summary.kg, null);
  assert.equal(summary.lastWeek, null);
});

test("nextSetSummary line 2: reps and RPE ranges with an en dash, no spaces (as the set view)", () => {
  const dips = setInContext([{ ...PULLDOWN, repsText: "6 - 10", prescribed: "RPE 7 - 8" }], { row: 7, set: 1 });
  assert.ok(dips !== null);
  assert.equal(nextSetSummary(dips, false, 2).line, "6–10 reps · RPE 7–8");
  assert.match(setSentence(dips, 1), /6 til 10 reps ved RPE 7 til 8/); // spoken: still "til"
});

test("setSentence: the spoken set, ranges as words, week 1 without last week", () => {
  const squat2 = setInContext(EXERCISES, { row: 4, set: 2 });
  const pull = setInContext(EXERCISES, { row: 7, set: 1 });
  assert.ok(squat2 !== null && pull !== null);
  assert.equal(setSentence(squat2, 3), "Squat, sæt 2 af 2: 5 reps ved RPE 7, i dag cirka 142,5 kg, et skøn, sidste uge 140 kg.");
  assert.equal(setSentence(squat2, 1), "Squat, sæt 2 af 2: 5 reps ved RPE 7, i dag cirka 142,5 kg, et skøn.");
  assert.equal(setSentence(pull, 3), "Lat pulldowns, sæt 1 af 1: 8 til 12 reps ved -12.5%."); // no kg, no last week: nothing said
  assert.doesNotMatch(setSentence(squat2, 3), /forslag|tilde|~/i);
  assert.equal(undoSentence(squat2), "Fortrudt: Squat, sæt 2 er åben igen.");
});

test("finishCard: counts with and without skips, first start and last end", () => {
  const all = tapAll([
    ["begin", ORDER[0], T0],
    ["done", ORDER[0], T1],
    ["done", ORDER[1], T1],
    ["done", ORDER[2], T2],
  ]);
  assert.deepEqual(finishCard(2, progress(ORDER, all), all), {
    title: "Session 2 er klaret",
    counts: "Alle 3 sæt udført",
    times: "Start kl. 18.00 · sidste sæt kl. 18.06",
  });
  const skipped = tapAll([
    ["skip", ORDER[0], T0],
    ["skip", ORDER[1], T1],
    ["skip", ORDER[2], T2],
  ]);
  const card = finishCard(1, progress(ORDER, skipped), skipped);
  assert.equal(card.counts, "0 af 3 sæt udført · 3 sprunget over");
  assert.equal(card.times, null);
  assert.equal(setKey(ORDER[0]), "4#1");
});

test("fokusStaleNote: nothing when fresh, the program sentence when stale or unknown", () => {
  assert.equal(fokusStaleNote({ kind: "fresh", computedAt: T0 }), null);
  assert.equal(
    fokusStaleNote({ kind: "stale", computedAt: "2026-10-11T03:03:00Z" }),
    "Programmet er sidst opdateret 11. okt. kl. 05.03 og kan være forældet.",
  );
  assert.match(fokusStaleNote({ kind: "unknown" }) ?? "", /kan være forældet/);
});

test("noSessionSentence: (c) with N = 1 and N > 1, and (d)", () => {
  assert.equal(noSessionSentence("all_done", 3), "Alle 3 sessioner er udført i denne uge.");
  assert.equal(noSessionSentence("all_done", 1), "Ugens session er udført.");
  assert.equal(noSessionSentence("no_program", 0), "Intet styrkeprogram i denne uge.");
});

test("D11: Fokus numbers sets across the run, in every text that shows the number", () => {
  const bench = (row: number, sets: number, name = "Bænk"): FokusExercise => ({
    ...SQUAT,
    name,
    row,
    sets: Array.from({ length: sets }, (_, i) => ({ row, set: i + 1 })),
  });
  const exercises = [bench(10, 1), bench(11, 1, "Bænk "), bench(12, 2), PULLDOWN];
  const first = setInContext(exercises, { row: 10, set: 1 });
  const second = setInContext(exercises, { row: 11, set: 1 });
  const last = setInContext(exercises, { row: 12, set: 2 });
  assert.ok(first !== null && second !== null && last !== null);
  assert.equal(setTitle(first), "Sæt 1 af 4");
  assert.equal(setTitle(last), "Sæt 4 af 4");
  assert.equal(nextSetSummary(second, false, 2).title, "Bænk · sæt 2 af 4");
  assert.match(setSentence(second, 3), /^Bænk, sæt 2 af 4: /);
  assert.equal(doneSentence(first), "Bænk, sæt 1 udført. Pause.");
  assert.equal(skipSentence(last), "Sæt 4 sprunget over.");
  assert.equal(undoSentence(second), "Fortrudt: Bænk, sæt 2 er åben igen.");
  assert.equal(
    lastTapText(exercises, { kind: "done", ref: { row: 12, set: 1 }, at: T0 }),
    "Bænk, sæt 3 udført kl. 18.00",
  );
  // A single-row run is unchanged.
  const pull = setInContext(exercises, { row: 7, set: 1 });
  assert.ok(pull !== null);
  assert.equal(setTitle(pull), "Sæt 1 af 1");
});

// fokus-pause.md (2026-10-13): warm-ups, pause variants, stepper, rest band, footer, suggestion line.
import { sessionOrderWithWarmups } from "../src/lib/set-taps.ts";
import {
  begunWarmup,
  durationText,
  footerText,
  nextFeel,
  repsRange,
  restBand,
  restSentence,
  restRail,
  stepperBounds,
  stepperValue,
} from "../src/lib/fokus-view.ts";
import { adjustmentBrackets, adjustmentLine } from "../src/lib/training-view.ts";

const W_ORDER = sessionOrderWithWarmups([
  { ref: { row: 4, set: 1 }, name: "Squat" },
  { ref: { row: 4, set: 2 }, name: "Squat" },
  { ref: { row: 7, set: 1 }, name: "Lat pulldowns" },
]);
function wTaps(taps: readonly ["begin" | "done" | "skip" | "undo", SetRef, string][]): Map<string, LoggedSet> {
  let log = new Map<string, LoggedSet>();
  for (const [kind, ref, at] of taps) log = applyTap(W_ORDER, log, kind, ref, at);
  return log;
}

test("pause variants: begin -> warm-up (A); Til sæt 1 -> set 1; done mid-run -> pause (B); done ending a run -> warm-up with feel (C)", () => {
  const begun = wTaps([["begin", { row: 4, set: 0 }, T0]]);
  assert.deepEqual(fokusState(W_ORDER, begun), { kind: "warmup", warmup: { row: 4, set: 0 }, since: T0, feel: null });
  assert.deepEqual(begunWarmup(W_ORDER, begun), { ref: { row: 4, set: 0 }, at: T0 });
  const warmedUp = applyTap(W_ORDER, begun, "done", { row: 4, set: 0 }, T1);
  // F5: the warm-up's done shows set 1 in the same layout, the timer counting from that tap (no feel row).
  assert.deepEqual(fokusState(W_ORDER, warmedUp), {
    kind: "set",
    next: { row: 4, set: 1 },
    rest: { since: T1, after: { row: 4, set: 0 } },
    showRest: true,
    feel: null,
  });
  assert.equal(begunWarmup(W_ORDER, warmedUp), null);
  const one = applyTap(W_ORDER, warmedUp, "done", { row: 4, set: 1 }, T2);
  assert.deepEqual(fokusState(W_ORDER, one), {
    kind: "set",
    next: { row: 4, set: 2 },
    rest: { since: T2, after: { row: 4, set: 1 } },
    showRest: true,
    feel: { row: 4, set: 1 },
  });
  const T3 = "2026-10-12T16:09:00.000Z";
  const two = applyTap(W_ORDER, one, "done", { row: 4, set: 2 }, T3);
  assert.deepEqual(fokusState(W_ORDER, two), { kind: "warmup", warmup: { row: 7, set: 0 }, since: T3, feel: { row: 4, set: 2 } });
});

test("pause variants: a skip that ends a run opens the next warm-up without a feel block (R5)", () => {
  const log = wTaps([
    ["done", { row: 4, set: 0 }, T0],
    ["done", { row: 4, set: 1 }, T1],
    ["skip", { row: 4, set: 2 }, T2],
  ]);
  const view = fokusState(W_ORDER, log);
  assert.equal(view.kind, "warmup");
  assert.equal(view.kind === "warmup" ? view.feel : "x", null);
});

test("reps stepper: ranges only; default = the log's value, else the top; bounds 1..top + 10", () => {
  assert.deepEqual(repsRange("6 - 10"), { low: 6, top: 10 });
  assert.deepEqual(repsRange("8-12"), { low: 8, top: 12 });
  assert.equal(repsRange("5"), null);
  assert.equal(repsRange("AMRAP"), null);
  assert.deepEqual(stepperBounds(10), { min: 1, max: 20 });
  assert.equal(stepperValue(null, 10), 10);
  assert.equal(stepperValue(8, 10), 8);
  assert.equal(stepperValue(40, 10), 20);
});

test("feel: tapping the chosen option clears it, another overwrites", () => {
  assert.equal(nextFeel(null, -1), -1);
  assert.equal(nextFeel(-1, -1), null);
  assert.equal(nextFeel(-1, 1), 1);
});

test("rest band: before the minimum, ready at it, over after the maximum; none without a recommendation", () => {
  // Round 3: no visible band line; the kinds drive the two sr-only announcements.
  assert.deepEqual(restBand(130, 180, 300), { kind: "before" });
  assert.deepEqual(restBand(180, 180, 300), { kind: "ready" });
  assert.deepEqual(restBand(301, 180, 300), { kind: "over" });
  assert.deepEqual(restBand(500, null, null), { kind: "none" });
  assert.equal(restSentence(restBand(180, 180, 300), 180, 300), "Anbefalet pause nået: 3 minutter. Klar til næste sæt.");
  assert.equal(restSentence(restBand(301, 180, 300), 180, 300), "Pausen er over 5 minutter.");
  assert.deepEqual(restRail(720, 180, 300), { fill: 1, min: 0.5, max: 1 / 1.2 });
});

test("footer: elapsed from the first start; remaining from 2 done sets; warm-ups and skips never count", () => {
  const log = wTaps([
    ["begin", { row: 4, set: 0 }, T0],
    ["done", { row: 4, set: 0 }, T1],
    ["done", { row: 4, set: 1 }, T2],
  ]);
  const now = Date.parse(T2) + 60_000;
  assert.equal(footerText(W_ORDER, new Map(), now), null);
  assert.equal(footerText(W_ORDER, log, now), "Tid brugt 7 min"); // one done set: no estimate
  const T3 = "2026-10-12T16:12:00.000Z";
  const more = applyTap(W_ORDER, log, "done", { row: 4, set: 2 }, T3); // spans 3 and 6 min: mean 4.5
  assert.equal(footerText(W_ORDER, more, Date.parse(T3)), "Tid brugt 12 min · ca. 5 min tilbage");
  assert.equal(durationText(65), "1 t 5 min");
  assert.equal(durationText(60), "1 t");
});

test("suggestion line: added, range, hold, capped + added, cap only; never 0 kg", () => {
  const base = { suggestedKg: 87.5, suggestionCapped: false, adjustmentKg: null, adjustmentReason: null };
  const added = { ...base, adjustmentKg: 2.5, adjustmentReason: "de sidste to var lettere" };
  assert.equal(adjustmentBrackets(added, "long"), "(+2,5 – de sidste to var lettere)");
  assert.equal(adjustmentBrackets(added, "short"), "(+2,5)");
  assert.deepEqual(adjustmentLine(added), { signed: "+2,5 kg", rest: " – de sidste to var lettere" });
  const range = { ...base, adjustmentKg: 2.5, adjustmentReason: "du ramte 10 reps to gange" };
  assert.deepEqual(adjustmentLine(range), { signed: "+2,5 kg", rest: " – du ramte 10 reps to gange" });
  const hold = { ...base, adjustmentKg: 0, adjustmentReason: "de sidste to var hårdere" };
  assert.equal(adjustmentBrackets(hold, "long"), "(holdt – de sidste to var hårdere)");
  assert.equal(adjustmentBrackets(hold, "short"), "(holdt)");
  assert.deepEqual(adjustmentLine(hold), { signed: "Holdt", rest: " – de sidste to var hårdere" });
  const cappedAdded = { ...added, suggestionCapped: true };
  assert.equal(adjustmentBrackets(cappedAdded, "long"), "(+2,5 – de sidste to var lettere, begrænset)");
  assert.equal(adjustmentLine(cappedAdded)?.rest, " – de sidste to var lettere · begrænset i forhold til sidste uge");
  const capOnly = { ...base, suggestionCapped: true };
  assert.equal(adjustmentBrackets(capOnly, "long"), "(begrænset)");
  assert.deepEqual(adjustmentLine(capOnly), { signed: "", rest: "(begrænset) i forhold til sidste uge" });
  assert.equal(adjustmentLine(base), null);
  assert.equal(adjustmentBrackets({ ...added, suggestedKg: null }, "long"), null);
  for (const e of [added, range, hold, cappedAdded, capOnly]) {
    assert.doesNotMatch(`${adjustmentBrackets(e, "long")} ${adjustmentLine(e)?.signed}`, /\b0 kg/);
  }
});

const rows = [
  { name: "Squat", aliases: ["Back squat"], category: "main" as const },
  { name: "Lat pulldowns", aliases: [], category: "accessory" as const },
  { name: "Bench press", aliases: ["Squat"], category: "main" as const }, // an alias never beats a name
  { name: "Pause squat", aliases: ["Bænkpres"], category: "accessory" as const },
];
const ex = (name: string, ramp: FokusExercise["ramp"] = null) => ({ name, ramp });

test("polish: finds main lifts by name or alias, trimmed and case-insensitive", () => {
  const keys = mainLiftKeys(rows);
  assert.equal(isMainLift(ex("  squat "), keys), true);
  assert.equal(isMainLift(ex("BACK SQUAT"), keys), true);
  assert.equal(isMainLift(ex("Bench press"), keys), true);
  assert.equal(isMainLift(ex("Lat pulldowns"), keys), false);
  assert.equal(isMainLift(ex("bænkpres"), keys), false); // alias of an accessory
});

test("polish: an unknown name or an unread catalogue is not a main lift; a ramp always is", () => {
  assert.equal(isMainLift(ex("Deadlift"), mainLiftKeys(rows)), false);
  assert.equal(isMainLift(ex("Squat"), mainLiftKeys(null)), false);
  assert.equal(mainLiftKeys(null), null);
  assert.equal(isMainLift(ex("Lat pulldowns", [{ pct: 40, reps: 5, kg: 20 }]), null), true);
});

test("polish: Fortryd of Begynd goes to Træning with the query it reads", () => {
  assert.equal(BEGIN_UNDONE_HREF, "/?fortrudt=begin");
  assert.equal(beginUndone(new URL(BEGIN_UNDONE_HREF, "http://x").search), true);
  assert.equal(beginUndone(""), false);
  assert.equal(beginUndone("?fortrudt=other"), false);
  assert.equal(BEGIN_UNDONE_TEXT, "Fortrudt: træningen er ikke begyndt.");
});
