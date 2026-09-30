import assert from "node:assert/strict";
import { test } from "node:test";

import { isoWeekNumber, isoWeekStart } from "../src/lib/dates.ts";
import type { TodayPlanData } from "../src/lib/db/queries.ts";
import {
  parsePlannedTargetRow,
  parsePrescribedSetRow,
  parseStrengthSessionRow,
  RowError,
} from "../src/lib/db/rows.ts";
import type {
  DailyLoadRow,
  PlannedTargetRow,
  PrescribedSetRow,
  StrengthSessionRow,
} from "../src/lib/db/rows.ts";
import { buildTodayPlan, localToday, resolveToday, todayHeader } from "../src/lib/today-view.ts";

const BLOK = "Program - blok 12 (offseason)";
const WEEK_40 = "2026-09-28";

function set(overrides: Partial<PrescribedSetRow>): PrescribedSetRow {
  return {
    weekStart: WEEK_40,
    session: 2,
    block: BLOK,
    week: 1,
    sheetRow: 25,
    setNo: 1,
    name: "Squat",
    type: "SQUAT",
    setsText: "1",
    repsText: "3",
    prescribed: "RPE 5.5",
    loggedKg: 0,
    bodyweight: false,
    ...overrides,
  };
}

/** A planned session of week 40; pass date/activity to mark it done. */
function session(n: number, overrides: Partial<StrengthSessionRow> = {}): StrengthSessionRow {
  return {
    weekStart: WEEK_40,
    session: n,
    block: BLOK,
    week: 1,
    activityId: null,
    date: null,
    activityName: null,
    movingTimeS: null,
    tss: 0,
    ...overrides,
  };
}

function doneOn(n: number, date: string): StrengthSessionRow {
  return session(n, { activityId: `i${n}`, date, activityName: "Styrke", movingTimeS: 4368, tss: 50 });
}

const LATEST: DailyLoadRow = {
  date: "2026-10-05",
  cyclingTss: 0,
  strengthTss: 0,
  totalTss: 0,
  ctl: 18,
  atl: 7,
  tsb: 10.8,
  ctlRamp7d: -3,
  formZone: "fresh",
  computedAt: "2026-10-05T03:00:00Z",
};

const RIDE: PlannedTargetRow = {
  date: "2026-10-08",
  name: "Zwift - Over-unders",
  notes: null,
  ftp: 250,
  totalMinutes: 68,
  steps: [
    { kind: "step", label: "Warm-up", minutes: 10, pctLow: 50, pctHigh: 75, wattsLow: 125, wattsHigh: 188 },
  ],
  problem: null,
  computedAt: "2026-10-05T03:00:00Z",
};

function data(overrides: Partial<TodayPlanData>): TodayPlanData {
  return {
    weekStart: WEEK_40,
    sessions: [],
    sets: [],
    previousWeek: [],
    rides: [],
    upcomingRides: [],
    ...overrides,
  };
}

const NOW = new Date("2026-10-05T10:00:00Z");

test("localToday uses Copenhagen, not UTC", () => {
  assert.equal(localToday(new Date("2026-09-27T22:30:00Z")), "2026-09-28"); // 00:30 CEST
  assert.equal(localToday(new Date("2026-01-15T22:30:00Z")), "2026-01-15"); // 23:30 CET
});

test("resolveToday honours DEV_TODAY only in development", () => {
  const now = new Date("2026-09-28T10:00:00Z");
  assert.equal(resolveToday(now, { NODE_ENV: "development", DEV_TODAY: "2026-10-01" }), "2026-10-01");
  assert.equal(resolveToday(now, { NODE_ENV: "production", DEV_TODAY: "2026-10-01" }), "2026-09-28");
  assert.equal(resolveToday(now, { NODE_ENV: "development", DEV_TODAY: "tomorrow" }), "2026-09-28");
  assert.equal(resolveToday(now, {}), "2026-09-28");
});

test("ISO week helpers", () => {
  assert.equal(isoWeekStart("2026-09-30"), WEEK_40);
  assert.equal(isoWeekStart("2026-10-04"), WEEK_40); // Sunday belongs to the week before
  assert.equal(isoWeekStart(WEEK_40), WEEK_40);
  assert.equal(isoWeekNumber("2026-09-30"), 40);
  assert.equal(isoWeekNumber("2027-01-01"), 53); // Friday: still ISO 2026-W53
  assert.equal(isoWeekNumber("2026-01-01"), 1);
});

test("week 40 example: Wed 30 Sept after one activity on Tue 29 shows session 2 of 3, undated", () => {
  const view = buildTodayPlan(
    data({
      sessions: [doneOn(1, "2026-09-29"), session(2), session(3)],
      sets: [
        set({ session: 1, sheetRow: 10, name: "Bench press" }),
        set({ session: 2, sheetRow: 25, name: "Squat" }),
        set({ session: 3, sheetRow: 40, name: "Dødløft" }),
      ],
    }),
    "2026-09-30",
  );
  assert.equal(view.kind, "strength");
  assert.equal(view.doneToday, false);
  const week = view.strength;
  assert.equal(week.state, "next");
  assert.deepEqual([week.next?.session, week.next?.of, week.next?.block], [2, 3, BLOK]);
  assert.deepEqual(week.next?.exercises.map((e) => e.name), ["Squat"]);
  assert.equal("date" in (week.next ?? {}), false); // a planned session has no date
  assert.deepEqual(week.done, [
    {
      session: 1,
      extra: false,
      date: "2026-09-29",
      isToday: false,
      activityName: "Styrke",
      movingTimeS: 4368,
    },
  ]);
});

test("next session: exercises in sheet order, one per row, with last week's kg as reference", () => {
  const view = buildTodayPlan(
    data({
      sessions: [session(1), session(2)],
      sets: [
        set({ session: 1, sheetRow: 27, setNo: 2, name: "Squat", setsText: "2", repsText: "5", prescribed: "-10%" }),
        set({ session: 1, sheetRow: 25 }),
        set({ session: 1, sheetRow: 27, setNo: 1, name: "Squat", setsText: "2", repsText: "5", prescribed: "-10%" }),
        set({ session: 1, sheetRow: 31, name: "Dips", type: "BACK", repsText: "8 - 12", bodyweight: true }),
      ],
      previousWeek: [
        set({ week: 0, weekStart: "2026-09-21", sheetRow: 25, loggedKg: 140 }),
        set({ week: 0, weekStart: "2026-09-21", sheetRow: 27, loggedKg: 0 }),
        set({ week: 0, weekStart: "2026-09-21", sheetRow: 31, loggedKg: 10, bodyweight: true }),
      ],
    }),
    "2026-09-28",
  );
  assert.equal(view.strength.next?.session, 1);
  assert.deepEqual(
    view.strength.next?.exercises.map((e) => [e.name, e.setsText, e.repsText, e.prescribed, e.reference]),
    [
      ["Squat", "1", "3", "RPE 5.5", { kg: 140, bodyweight: false }],
      ["Squat", "2", "5", "-10%", null], // nothing logged last week
      ["Dips", "1", "8 - 12", "RPE 5.5", { kg: 10, bodyweight: true }],
    ],
  );
});

test("three activities: all sessions done this week, rest card, next week's Monday", () => {
  const view = buildTodayPlan(
    data({
      sessions: [
        doneOn(1, "2026-09-29"),
        doneOn(2, "2026-09-30"),
        doneOn(3, "2026-10-02"),
        session(1, { weekStart: "2026-10-05" }), // next week's plan must not leak in
      ],
      upcomingRides: [RIDE],
    }),
    "2026-10-02",
  );
  assert.equal(view.strength.state, "all_done");
  assert.equal(view.strength.next, null);
  assert.equal(view.strength.planned, 3);
  assert.equal(view.strength.nextWeekStart, "2026-10-05");
  assert.equal(view.kind, "rest");
  assert.equal(view.doneToday, true);
  assert.deepEqual(view.next, { date: "2026-10-08", isTomorrow: false, rides: ["Zwift - Over-unders"] });
});

test("an extra activity beyond the program is listed as extra; no program means no_program", () => {
  const extra = session(4, { block: null, week: null, activityId: "x", date: "2026-10-03", activityName: "Styrke" });
  const full = buildTodayPlan(
    data({ sessions: [doneOn(1, "2026-09-29"), doneOn(2, "2026-09-30"), doneOn(3, "2026-10-01"), extra] }),
    "2026-10-03",
  );
  assert.equal(full.strength.state, "all_done");
  assert.deepEqual(full.strength.done.map((d) => [d.session, d.extra]), [
    [1, false],
    [2, false],
    [3, false],
    [4, true],
  ]);

  const week39 = buildTodayPlan(
    data({
      weekStart: "2026-09-21",
      sessions: [session(1, { weekStart: "2026-09-21", block: null, week: null, activityId: "a", date: "2026-09-22" })],
    }),
    "2026-09-23",
  );
  assert.equal(week39.strength.state, "no_program");
  assert.equal(week39.strength.isoWeek, 39);
  assert.equal(week39.strength.done[0]?.extra, true);
  assert.equal(week39.kind, "rest");
});

test("todayHeader: TSB, zone and freshness from the latest row; null without rows", () => {
  const header = todayHeader(LATEST, NOW);
  assert.equal(header?.tsb, 10.8);
  assert.equal(header?.zone?.label, "Fresh");
  assert.equal(header?.freshness.kind, "fresh");
  assert.equal(header?.date, "2026-10-05");
  assert.equal(todayHeader(null, NOW), null);
});

test("ride day, both, and the next planned ride", () => {
  const ride = buildTodayPlan(data({ rides: [{ ...RIDE, date: "2026-10-05" }] }), "2026-10-05");
  assert.equal(ride.kind, "ride");
  assert.equal(ride.rides[0]?.steps[0]?.kind, "step");

  const both = buildTodayPlan(
    data({ sessions: [session(1)], sets: [set({ session: 1 })], rides: [{ ...RIDE, date: "2026-10-01" }] }),
    "2026-10-01",
  );
  assert.equal(both.kind, "both");

  const rest = buildTodayPlan(data({ upcomingRides: [RIDE] }), "2026-10-07");
  assert.equal(rest.kind, "rest");
  assert.deepEqual(rest.next, { date: "2026-10-08", isTomorrow: true, rides: ["Zwift - Over-unders"] });

  assert.equal(buildTodayPlan(data({}), "2026-10-06").next, null);
});

test("parsers for the Today rows", () => {
  const row = parsePrescribedSetRow({
    week_start: "2026-09-28",
    session: 1,
    sheet_id: "s",
    block: BLOK,
    week: 1,
    sheet_row: 31,
    set_no: 1,
    name: "Zercher FFE split squat",
    type: "QUADS/ADDUCTORS",
    sets_text: "2",
    reps_text: "8 - 12",
    prescribed: "RPE 5 - 6",
    logged_kg: 0,
    bodyweight: false,
  });
  assert.deepEqual([row.weekStart, row.session, row.repsText], ["2026-09-28", 1, "8 - 12"]);

  const planned = parseStrengthSessionRow({
    week_start: "2026-09-28",
    session: 2,
    block: BLOK,
    week: 1,
    activity_id: null,
    date: null,
    activity_name: null,
    moving_time_s: null,
    tss: 0,
  });
  assert.deepEqual([planned.session, planned.date, planned.block], [2, null, BLOK]);
  assert.throws(() => parseStrengthSessionRow({ week_start: "2026-09-28", session: "x" }), RowError);

  const target = parsePlannedTargetRow({
    date: "2026-10-01",
    name: "Zwift - Over-unders",
    notes: null,
    ftp: 250,
    total_minutes: 68,
    steps: [
      { kind: "step", label: "Warm-up", minutes: 10, pct_low: 50, pct_high: 75, watts_low: 125, watts_high: 188 },
      {
        kind: "repeat",
        repeat: 4,
        steps: [{ kind: "step", label: "On", minutes: 8, pct_low: 95, pct_high: 95, watts_low: 238, watts_high: 238 }],
      },
    ],
    problem: null,
    computed_at: "2026-09-28T03:00:00+00:00",
  });
  assert.equal(target.steps[1]?.kind, "repeat");
  assert.throws(
    () =>
      parsePlannedTargetRow({
        date: "2026-10-01",
        name: "x",
        notes: null,
        ftp: null,
        total_minutes: 0,
        steps: [{ kind: "sprint" }],
        problem: null,
        computed_at: "2026-09-28T03:00:00Z",
      }),
    RowError,
  );
});
