import assert from "node:assert/strict";
import { test } from "node:test";

import type { DoneSession } from "../src/lib/training-view.ts";
import { datedPlan, planLabel, weekRows } from "../src/lib/week-plan.ts";

const done = (session: number, date: string, extra = false): DoneSession => ({
  session,
  extra,
  date,
  isToday: false,
  activityName: "Styrke",
  movingTimeS: 3120,
});

const week = {
  columns: [
    { session: 1, sets: 19, status: "done" as const },
    { session: 2, sets: 18, status: "current" as const },
    { session: 3, sets: 17, status: "future" as const },
  ],
  done: [done(1, "2026-10-13"), done(4, "2026-10-14", true)],
};

test("weekRows: done, current and future in session order, extras after", () => {
  const rows = weekRows(week);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["done", "current", "future", "extra"],
  );
  assert.equal(rows[0].kind === "done" ? rows[0].sets : null, 19);
});

test("weekRows: no program, no rows", () => {
  assert.deepEqual(weekRows({ columns: [], done: [] }), []);
});

test("planLabel: the same words on Træning and /load", () => {
  assert.equal(planLabel(2), "Styrke · session 2");
});

test("datedPlan: today's row gets the current session, later sessions are undated, done ones are not repeated", () => {
  const plan = datedPlan(week, "2026-10-14", ["2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.deepEqual(plan.today, { kind: "current", session: 2 });
  assert.deepEqual(plan.undated, [{ kind: "future", session: 3 }]);
});

test("datedPlan: today not listed yet (no daily_load row) puts the current session first among the undated", () => {
  const plan = datedPlan(week, "2026-10-14", ["2026-10-12", "2026-10-13"]);
  assert.equal(plan.today, null);
  assert.deepEqual(plan.undated, [
    { kind: "current", session: 2 },
    { kind: "future", session: 3 },
  ]);
});

test("datedPlan: all done or no program, nothing planned", () => {
  const allDone = {
    columns: [{ session: 1, sets: 19, status: "done" as const }],
    done: [done(1, "2026-10-13")],
  };
  assert.deepEqual(datedPlan(allDone, "2026-10-14", ["2026-10-14"]), { today: null, undated: [] });
  assert.deepEqual(datedPlan({ columns: [], done: [] }, "2026-10-14", ["2026-10-14"]), { today: null, undated: [] });
});

test("datedPlan: a session done today keeps the next one off today's row, undated as plan", () => {
  const doneToday = {
    columns: [
      { session: 1, sets: 19, status: "done" as const },
      { session: 2, sets: 18, status: "current" as const },
      { session: 3, sets: 17, status: "future" as const },
    ],
    done: [done(1, "2026-10-14")],
  };
  const plan = datedPlan(doneToday, "2026-10-14", ["2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.equal(plan.today, null);
  assert.deepEqual(plan.undated, [
    { kind: "future", session: 2 },
    { kind: "future", session: 3 },
  ]);
  assert.deepEqual(
    weekRows(doneToday, "2026-10-14").map((r) => r.kind),
    ["done", "future", "future"],
  );
  assert.deepEqual(
    weekRows(doneToday).map((r) => r.kind),
    ["done", "current", "future"],
  );
});
