import assert from "node:assert/strict";
import { test } from "node:test";

import {
  devFixture,
  fixtureError,
  ILLUSTRATIVE_REMAINING_TSS,
  illustrativeWeeklyPlan,
  midsessionLog,
  comboSets,
  COMBO_VARIANT,
  jumpedFixture,
  supersetOfferLog,
  illustrativeToday,
  midsessionPlanned,
  pauseFixture,
  STALE_AGE_MS,
  staleComputedAt,
} from "../src/lib/db/dev-fixture.ts";
import { fokusState } from "../src/lib/fokus-view.ts";
import { firstOpen, type LoggedSet, sessionOrderWithWarmups, setKey, shapeOrder } from "../src/lib/set-taps.ts";
import type { PrescribedSetRow } from "../src/lib/db/rows.ts";
import { PostgrestError } from "../src/lib/db/postgrest.ts";
import { freshness } from "../src/lib/dashboard-view.ts";

test("DEV_FIXTURE only switches under next dev, and only to known states", () => {
  for (const state of ["empty", "stale", "error", "band", "ef-few", "lsrpe", "midsession", "answers", "warmup", "pause", "exercise-end", "pause-rated", "finished", "feel", "calendar", "ftp-warning", "ftp-quiet", "superset", "superset-suggested", "sheet", "sheet-superset", "jumped", "superset-offer", "combo", "recording", "camera-denied"] as const) {
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
  assert.deepEqual(warnings, ["DEV_FIXTURE=stal ignored: expected empty, stale, error, band, ef-few, lsrpe, midsession, answers, warmup, pause, exercise-end, pause-rated, finished, feel, calendar, ftp-warning, ftp-quiet, superset, superset-suggested, sheet, sheet-superset, jumped, superset-offer, combo, recording, camera-denied, clips, superset-pick"]);
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
    return { out, view: fokusState(order, log) };
  };
  assert.equal(viewOf("warmup").view.kind, "warmup");
  // A ramp only ever on a main lift: Dips (first here) warms up on the timer only.
  assert.ok(!viewOf("warmup").out.plannedSets.some((p) => p.ramp !== null));
  // fokus-flow.md §1: the pause fixture is the next set, with its rest strip and the optional feel row.
  const pause = viewOf("pause");
  assert.equal(pause.view.kind, "set");
  assert.ok(pause.view.kind === "set" && pause.view.showRest && pause.view.feel !== null);
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
  assert.deepEqual(out.map((p) => [p.sheetRow, p.adjustmentKg, p.uncappedKg !== null]), [[1, 2.5, false], [2, 2.5, true], [3, 0, false], [4, null, false]]);
});

test("DEV_FIXTURE midsession/pause: today's kg covers every basis (fokus-kg.md), none on the 5th row", () => {
  const row = (sheetRow: number) => ({
    weekStart: "2026-10-12", session: 1, block: "B", week: 3, sheetRow, setNo: 1, name: `E${sheetRow}`, type: "X",
    setsText: "1", repsText: "5", prescribed: "RPE 7", loggedKg: 50, bodyweight: false, variantId: null, variant: null,
  });
  const out = illustrativeToday([1, 2, 3, 4, 5, 6].map(row), []);
  assert.deepEqual(
    out.map((p) => [p.sheetRow, p.todayBasis, p.todayKg]),
    [[1, "sheet", 50], [2, "e1rm", 50], [3, "derived", 50], [4, "last", 50], [5, null, null]],
  );
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
    return { out, view: fokusState(order, new Map<string, LoggedSet>(out.setLog.map((l) => [setKey(l), l]))) };
  };
  const rated = viewOf("pause-rated");
  assert.equal(rated.view.kind, "set");
  assert.ok(rated.view.kind === "set" && rated.view.showRest);
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

// Slice fokus-sheet: the jumped, superset-offer and combo fixtures (never written).
function sheetRows(): PrescribedSetRow[] {
  const runs: [number, string, number][] = [[30, "Squat", 2], [31, "Bench", 3], [32, "Row", 2], [33, "Curl", 2]];
  return runs.flatMap(([sheetRow, name, n]) =>
    Array.from({ length: n }, (_, k) => ({
      weekStart: "2026-10-12", session: 1, block: "B", week: 3, sheetRow, setNo: k + 1, name, type: "X", setsText: String(n),
      repsText: "5", prescribed: null, loggedKg: null, bodyweight: false, variantId: null, variant: null,
    })),
  );
}

test("jumped: A done, B1 done, then the jump: C's warm-up current with B1's end, B2 right after C", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");
  const { setLog, sessionOrders } = jumpedFixture(sheetRows(), "2026-10-12", now);
  assert.deepEqual(sessionOrders.map((o) => o.runRows), [[30, 32, 31, 33]]);
  const log = new Map<string, LoggedSet>(setLog.map((r) => [setKey(r), r]));
  const order = shapeOrder({ sets: sheetRows().map((r) => ({ ref: { row: r.sheetRow, set: r.setNo }, name: r.name })), pairs: [], runRows: sessionOrders[0].runRows });
  assert.equal(setKey(firstOpen(order, log) ?? { row: 0, set: 0 }), "32#0");
  assert.equal(log.get("32#0")?.startedAt, log.get("31#1")?.endedAt);
  assert.equal(log.get("31#1")?.endedAt, new Date(now.getTime() - 102_000).toISOString());
  assert.equal(log.get("31#2"), undefined); // B2 is upcoming again
  assert.equal(order.filter((r) => r.row === 31 && r.set === 2).length, 1);
  assert.ok(order.findIndex((r) => setKey(r) === "31#2") > order.findIndex((r) => setKey(r) === "32#2"));
});

test("superset-offer: only Begynd, on the first run's warm-up", () => {
  const log = supersetOfferLog(sheetRows(), "2026-10-12", new Date("2026-10-12T10:00:00.000Z"));
  assert.deepEqual(log.map((r) => [r.row, r.set, r.startedAt !== null, r.endedAt]), [[30, 0, true, null]]);
});

test("combo: the row of the last done set (midsession) carries the combined variant, nothing else changes", () => {
  const rows = comboSets(sheetRows());
  assert.deepEqual([...new Set(rows.filter((r) => r.variantId === COMBO_VARIANT.variantId).map((r) => r.sheetRow))], [31]);
  assert.ok(COMBO_VARIANT.variant.includes("+"));
});
