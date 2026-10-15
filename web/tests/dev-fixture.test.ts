import assert from "node:assert/strict";
import { test } from "node:test";

import {
  devFixture,
  fixtureError,
  ILLUSTRATIVE_REMAINING_TSS,
  illustrativeWeeklyPlan,
  midsessionLog,
  midsessionPlanned,
  pauseFixture,
  STALE_AGE_MS,
  staleComputedAt,
} from "../src/lib/db/dev-fixture.ts";
import { fokusView } from "../src/lib/fokus-view.ts";
import { type LoggedSet, sessionOrderWithWarmups, setKey } from "../src/lib/set-taps.ts";
import { PostgrestError } from "../src/lib/db/postgrest.ts";
import { freshness } from "../src/lib/dashboard-view.ts";

test("DEV_FIXTURE only switches under next dev, and only to known states", () => {
  for (const state of ["empty", "stale", "error", "band", "ef-few", "lsrpe", "midsession", "answers", "warmup", "pause", "exercise-end", "pause-rated", "finished", "feel", "calendar", "ftp-warning", "ftp-quiet"] as const) {
    assert.equal(devFixture({ DEV_FIXTURE: state }, "development"), state);
    assert.equal(devFixture({ DEV_FIXTURE: state }, "production"), null);
    assert.equal(devFixture({ DEV_FIXTURE: state }, "test"), null);
    // The build inlines NODE_ENV; an env var claiming "development" changes nothing.
    assert.equal(devFixture({ NODE_ENV: "development", DEV_FIXTURE: state }, "production"), null);
  }
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    assert.equal(devFixture({ DEV_FIXTURE: "stal" }, "development"), null);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, ["DEV_FIXTURE=stal ignored: expected empty, stale, error, band, ef-few, lsrpe, midsession, answers, warmup, pause, exercise-end, pause-rated, finished, feel, calendar, ftp-warning, ftp-quiet"]);
  assert.equal(devFixture({}, "development"), null);
});

test("the error fixture is an ordinary data error and the stale one is past the 26 h limit", () => {
  const error = fixtureError("daily_load");
  assert.ok(error instanceof PostgrestError);
  assert.equal(error.table, "daily_load");
  const now = new Date("2026-09-30T10:00:00Z");
  assert.equal(Date.parse(staleComputedAt(now)), now.getTime() - STALE_AGE_MS);
  assert.equal(freshness(staleComputedAt(now), now).kind, "stale");
});

test("DEV_FIXTURE=midsession: per session, 3 sets done 3 min apart, then one skipped", () => {
  const set = (session: number, sheetRow: number, setNo: number) => ({
    weekStart: "2026-10-12",
    session,
    block: "B",
    week: 3,
    sheetRow,
    setNo,
    name: "Squat",
    type: "SQUAT",
    setsText: "2",
    repsText: "3",
    prescribed: "RPE 6",
    loggedKg: null,
    bodyweight: false,
    variantId: null, variant: null,
  });
  const now = new Date("2026-10-12T16:00:00Z");
  const log = midsessionLog([set(1, 26, 1), set(1, 25, 2), set(1, 25, 1), set(1, 27, 1), set(1, 28, 1), set(2, 77, 1)], "2026-10-12", now);
  const one = log.filter((l) => l.session === 1);
  assert.deepEqual(one.map((l) => [l.row, l.set, l.skipped]), [[25, 1, false], [25, 2, false], [26, 1, false], [27, 1, true]]);
  assert.equal(one[2]?.endedAt, new Date(now.getTime() - 102_000).toISOString()); // rest timer 1:42
  assert.deepEqual(log.filter((l) => l.session === 2).map((l) => l.row), [77]);
});

test("DEV_FIXTURE warmup / pause / exercise-end: each gives its Fokus view (pure: nothing is written)", () => {
  const row = (sheetRow: number, setNo: number, name: string, repsText: string) => ({
    weekStart: "2026-10-12",
    session: 1,
    block: "B",
    week: 3,
    sheetRow,
    setNo,
    name,
    type: "X",
    setsText: "2",
    repsText,
    prescribed: "RPE 7",
    loggedKg: 60,
    bodyweight: false,
    variantId: null, variant: null,
  });
  const sets = [row(5, 1, "Dips", "6 - 10"), row(5, 2, "Dips", "6 - 10"), row(6, 1, "Squat", "5"), row(6, 2, "Squat", "5")];
  const order = sessionOrderWithWarmups(sets.map((s) => ({ ref: { row: s.sheetRow, set: s.setNo }, name: s.name })));
  const now = new Date("2026-10-12T16:00:00Z");
  const viewOf = (f: "warmup" | "pause" | "exercise-end") => {
    const out = pauseFixture(f, sets, [], "2026-10-12", now);
    const log = new Map<string, LoggedSet>(out.setLog.map((l) => [setKey(l), l]));
    return { out, view: fokusView(order, log, null) };
  };
  assert.equal(viewOf("warmup").view.kind, "warmup");
  // A ramp only ever on a main lift: Dips (first here) warms up on the timer only.
  assert.ok(!viewOf("warmup").out.plannedSets.some((p) => p.ramp !== null));
  const pause = viewOf("pause");
  assert.equal(pause.view.kind, "pause");
  assert.ok(pause.out.setLog.some((l) => l.repsDone === 10)); // the server's default at Udført
  const end = viewOf("exercise-end");
  assert.deepEqual(end.view, { kind: "warmup", warmup: { row: 6, set: 0 }, since: new Date(now.getTime() - 40_000).toISOString(), feel: { row: 5, set: 2 } });
  assert.deepEqual([...new Set(end.out.plannedSets.filter((p) => p.ramp !== null).map((p) => p.sheetRow))], [6]); // Squat's ramp
});

test("DEV_FIXTURE=midsession: adjustments (+2,5, capped, hold) and a note, illustrative", () => {
  const row = (sheetRow: number) => ({
    weekStart: "2026-10-12", session: 1, block: "B", week: 3, sheetRow, setNo: 1, name: `E${sheetRow}`, type: "X",
    setsText: "1", repsText: "5", prescribed: "RPE 7", loggedKg: 50, bodyweight: false, variantId: null, variant: null,
  });
  const out = midsessionPlanned([row(1), row(2), row(3), row(4)], []);
  assert.deepEqual(out.map((p) => [p.sheetRow, p.adjustmentKg, p.uncappedKg !== null]), [[1, 2.5, false], [2, 2.5, true], [3, 0, false]]);
});

test("DEV_FIXTURE pause-rated / finished (fokus-round4.md §5): pure, nothing is written", () => {
  const row = (sheetRow: number, setNo: number, name: string, repsText: string, loggedKg: number | null = 60) => ({
    weekStart: "2026-10-12",
    session: 1,
    block: "B",
    week: 3,
    sheetRow,
    setNo,
    name,
    type: "X",
    setsText: "3",
    repsText,
    prescribed: "RPE 7",
    loggedKg,
    bodyweight: false,
    variantId: null, variant: null,
  });
  const sets = [
    row(5, 1, "Dips", "6 - 10"), row(5, 2, "Dips", "6 - 10"), row(5, 3, "Dips", "6 - 10"),
    row(6, 1, "Squat", "5"), row(6, 2, "Squat", "5"), row(6, 3, "Squat", "5"),
    row(7, 1, "Curl", "8 - 12"), row(7, 2, "Curl", "8 - 12"),
  ];
  const order = sessionOrderWithWarmups(sets.map((s) => ({ ref: { row: s.sheetRow, set: s.setNo }, name: s.name })));
  const now = new Date("2026-10-12T16:00:00Z");
  const viewOf = (f: "pause-rated" | "finished") => {
    const out = pauseFixture(f, sets, [], "2026-10-12", now);
    return { out, view: fokusView(order, new Map<string, LoggedSet>(out.setLog.map((l) => [setKey(l), l])), null) };
  };
  const rated = viewOf("pause-rated");
  assert.equal(rated.view.kind, "pause");
  const doneSet = rated.out.setLog.find((l) => l.row === 5 && l.set === 1);
  assert.equal(doneSet?.feltRpe, 1);
  assert.equal(doneSet?.endedAt, new Date(now.getTime() - 220_000).toISOString()); // 3:40, between MIN 3:00 and MAX 5:00
  const fin = viewOf("finished");
  assert.equal(fin.view.kind, "finished");
  const log = fin.out.setLog;
  assert.equal(log.length, order.length); // every item tapped, warm-ups included
  assert.equal(log.filter((l) => l.skipped).length, 2);
  assert.ok(log.some((l) => l.set > 0 && !l.skipped && l.feltRpe === null)); // unrated
  assert.ok(new Set(log.map((l) => l.feltRpe)).size >= 3);
  assert.ok(log.filter((l) => l.row !== 6 && l.set > 0 && !l.skipped).every((l) => l.repsDone !== null)); // range rows
  // Logged kg for the first exercise only.
  assert.deepEqual([...new Set(fin.out.sets.filter((s) => s.loggedKg !== null).map((s) => s.name))], ["Dips"]);
  // Rests between done taps: 1:30–5:00 and one > 6 min.
  const ends = log.filter((l) => l.endedAt !== null).map((l) => Date.parse(l.endedAt ?? "")).toSorted((a, b) => a - b);
  const rests = ends.slice(1).map((e, i) => (e - ends[i]) / 1000);
  assert.ok(rests.some((r) => r > 360));
  assert.ok(rests.filter((r) => r <= 360).every((r) => r >= 90 && r <= 300));
});

const WEEK_41 = { weekStart: "2026-10-05", weekEnd: "2026-10-11", isoYear: 2026, isoWeek: 41, cyclingTss: 150, strengthTss: 60, totalTss: 210, days: 7 };
const WEEK_42 = { weekStart: "2026-10-12", weekEnd: "2026-10-18", isoYear: 2026, isoWeek: 42, cyclingTss: 80, strengthTss: 40, totalTss: 120, days: 3 };
const PLAN_41 = { weekStart: "2026-10-05", weekEnd: "2026-10-11", isoYear: 2026, isoWeek: 41, doneTss: 210, remainingTss: null, plannedTss: null };

test("illustrativeWeeklyPlan gives the current week a planned value when the read failed", () => {
  assert.deepEqual(illustrativeWeeklyPlan([WEEK_41, WEEK_42], null), [
    { weekStart: "2026-10-12", weekEnd: "2026-10-18", isoYear: 2026, isoWeek: 42, doneTss: 120, remainingTss: ILLUSTRATIVE_REMAINING_TSS, plannedTss: 120 + ILLUSTRATIVE_REMAINING_TSS },
  ]);
});

test("illustrativeWeeklyPlan keeps real rows and a real planned value; fills only a current week without one", () => {
  const real42 = { ...PLAN_41, weekStart: "2026-10-12", weekEnd: "2026-10-18", isoWeek: 42, doneTss: 118, remainingTss: 40, plannedTss: 158 };
  assert.deepEqual(illustrativeWeeklyPlan([WEEK_41, WEEK_42], [PLAN_41, real42]), [PLAN_41, real42]);
  const filled = illustrativeWeeklyPlan([WEEK_41, WEEK_42], [PLAN_41, { ...real42, remainingTss: null, plannedTss: null }]);
  assert.deepEqual(filled[0], PLAN_41); // past weeks stay done-only
  assert.equal(filled[1].doneTss, 118); // the view's done, not weekly_load's
  assert.equal(filled[1].plannedTss, 118 + ILLUSTRATIVE_REMAINING_TSS);
  assert.deepEqual(illustrativeWeeklyPlan([], null), []);
});
