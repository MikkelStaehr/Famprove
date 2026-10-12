import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clockTime,
  doneSentence,
  elapsedSeconds,
  finishCard,
  type FokusExercise,
  fokusStaleNote,
  fokusView,
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
  suggestionReason,
  undoSentence,
  unsavedText,
} from "../src/lib/fokus-view.ts";
import { applyTap, type LoggedSet, progress, setKey, type SetRef } from "../src/lib/set-taps.ts";

const SQUAT: FokusExercise = {
  name: "Squat ",
  repsText: "5",
  prescribed: "RPE 7",
  bodyweight: false,
  reference: { kg: 140, bodyweight: false },
  row: 4,
  suggestedKg: 142.5,
  suggestionBasis: "rpe_e1rm",
  sets: [
    { row: 4, set: 1 },
    { row: 4, set: 2 },
  ],
};
const PULLDOWN: FokusExercise = {
  name: "Lat pulldowns",
  repsText: "8 - 12",
  prescribed: "-12.5%",
  bodyweight: false,
  reference: null,
  row: 7,
  suggestedKg: null,
  suggestionBasis: "not_rpe",
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

test("fokusView: set view at the first open set before any tap", () => {
  assert.deepEqual(fokusView(ORDER, new Map(), null), { kind: "set", current: ORDER[0] });
});

test("fokusView: rest view after a done, counting from that tap, next = first open set", () => {
  const log = tapAll([["done", ORDER[0], T0]]);
  assert.deepEqual(fokusView(ORDER, log, null), { kind: "rest", since: T0, next: ORDER[1] });
});

test("fokusView: Til næste sæt dismisses that rest only; the next done rests again", () => {
  const log = tapAll([["done", ORDER[0], T0]]);
  assert.deepEqual(fokusView(ORDER, log, T0), { kind: "set", current: ORDER[1] });
  const later = applyTap(ORDER, log, "done", ORDER[1], T1);
  assert.deepEqual(fokusView(ORDER, later, T0), { kind: "rest", since: T1, next: ORDER[2] });
});

test("fokusView: a skip as the latest tap shows the next set directly (no rest)", () => {
  const log = tapAll([
    ["done", ORDER[0], T0],
    ["skip", ORDER[1], T1],
  ]);
  assert.deepEqual(fokusView(ORDER, log, null), { kind: "set", current: ORDER[2] });
});

test("fokusView: finished when no set is open, also with skips", () => {
  const log = tapAll([
    ["done", ORDER[0], T0],
    ["skip", ORDER[1], T1],
    ["done", ORDER[2], T2],
  ]);
  assert.deepEqual(fokusView(ORDER, log, null), { kind: "finished" });
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

test("kgBlock: suggestion first, italic figure with kg", () => {
  assert.deepEqual(kgBlock(SQUAT), { kind: "suggestion", label: "Forslag", figure: "142,5", unit: "kg" });
});

test("kgBlock: no suggestion -> last week upright with the reason; both null -> Kg / Intet forslag", () => {
  assert.deepEqual(kgBlock({ ...PULLDOWN, reference: { kg: 60, bodyweight: false } }), {
    kind: "last_week",
    label: "Sidste uge",
    figure: "60",
    unit: "kg",
    reason: "Intet forslag til %-sæt",
  });
  assert.deepEqual(kgBlock(PULLDOWN), {
    kind: "none",
    label: "Kg",
    text: "Intet forslag",
    reason: "Intet forslag til %-sæt",
  });
  const bw = kgBlock({ ...PULLDOWN, bodyweight: true, reference: { kg: 0, bodyweight: true } });
  assert.equal(bw.kind === "last_week" && bw.figure, "kropsvægt");
  assert.equal(bw.kind === "last_week" && bw.unit, null);
});

test("suggestionReason: the three bases, nothing for a null basis", () => {
  assert.equal(suggestionReason("no_e1rm"), "Intet forslag: ingen e1RM endnu");
  assert.equal(suggestionReason("no_lift"), "Intet forslag til denne øvelse");
  assert.equal(suggestionReason(null), null);
});

test("lastWeekLine: only under a suggestion; week 1 and nothing logged have their words", () => {
  assert.deepEqual(lastWeekLine(SQUAT, 3), { kind: "kg", text: "140 kg" });
  assert.deepEqual(lastWeekLine({ ...SQUAT, reference: null }, 3), { kind: "none", text: "Intet logget sidste uge" });
  assert.deepEqual(lastWeekLine(SQUAT, 1), { kind: "week1", text: "Uge 1 i blokken: ingen sidste uge" });
  assert.equal(lastWeekLine(PULLDOWN, 3), null);
});

test("lastTapText: done with its time, skip without", () => {
  assert.equal(
    lastTapText(EXERCISES, { ref: { row: 4, set: 1 }, kind: "done", at: "2026-10-12T16:42:00Z" }),
    "Squat · sæt 1 udført kl. 18.42",
  );
  assert.equal(lastTapText(EXERCISES, { ref: { row: 4, set: 2 }, kind: "skip", at: T1 }), "Squat · sæt 2 sprunget over");
});

test("skippedText and unsavedText", () => {
  assert.equal(skippedText({ done: 7, skipped: 0, total: 24 }), null);
  assert.equal(skippedText({ done: 7, skipped: 1, total: 24 }), "· 1 sprunget over");
  assert.equal(unsavedText(1), "1 sæt er ikke gemt.");
  assert.equal(unsavedText(3), "3 sæt er ikke gemt.");
});

test("nextSetSummary: title and the short line, with or without a suggestion", () => {
  const squat2 = setInContext(EXERCISES, { row: 4, set: 2 });
  assert.ok(squat2 !== null);
  assert.deepEqual(nextSetSummary(squat2), {
    title: "Squat · sæt 2 af 2",
    line: "5 reps · RPE 7 · forslag 142,5 kg",
  });
  const pull = setInContext(EXERCISES, { row: 7, set: 1 });
  assert.ok(pull !== null);
  assert.equal(nextSetSummary(pull).line, "8 - 12 reps · -12.5% · intet forslag");
});

test("setSentence: the spoken set, ranges as words, week 1 without last week", () => {
  const squat2 = setInContext(EXERCISES, { row: 4, set: 2 });
  const pull = setInContext(EXERCISES, { row: 7, set: 1 });
  assert.ok(squat2 !== null && pull !== null);
  assert.equal(setSentence(squat2, 3), "Squat, sæt 2 af 2: 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg.");
  assert.equal(setSentence(squat2, 1), "Squat, sæt 2 af 2: 5 reps ved RPE 7, forslag 142,5 kg.");
  assert.equal(
    setSentence(pull, 3),
    "Lat pulldowns, sæt 1 af 1: 8 til 12 reps ved -12.5%, intet forslag, intet logget sidste uge.",
  );
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
  assert.equal(nextSetSummary(second).title, "Bænk · sæt 2 af 4");
  assert.match(setSentence(second, 3), /^Bænk, sæt 2 af 4: /);
  assert.equal(doneSentence(first), "Bænk, sæt 1 udført. Pause.");
  assert.equal(skipSentence(last), "Sæt 4 sprunget over.");
  assert.equal(undoSentence(second), "Fortrudt: Bænk, sæt 2 er åben igen.");
  assert.equal(
    lastTapText(exercises, { kind: "done", ref: { row: 12, set: 1 }, at: T0 }),
    "Bænk · sæt 3 udført kl. 18.00",
  );
  // A single-row run is unchanged.
  const pull = setInContext(exercises, { row: 7, set: 1 });
  assert.ok(pull !== null);
  assert.equal(setTitle(pull), "Sæt 1 af 1");
});
