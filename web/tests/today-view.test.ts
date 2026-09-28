import assert from "node:assert/strict";
import { test } from "node:test";

import type { TodayData } from "../src/lib/db/queries.ts";
import {
  parsePlannedTargetRow,
  parsePrescribedSetRow,
  RowError,
} from "../src/lib/db/rows.ts";
import type { DailyLoadRow, PlannedTargetRow, PrescribedSetRow } from "../src/lib/db/rows.ts";
import { buildTodayView, localToday, resolveToday } from "../src/lib/today-view.ts";

const BLOK = "Program - blok 12 (offseason)";

function set(overrides: Partial<PrescribedSetRow>): PrescribedSetRow {
  return {
    date: "2026-10-05",
    block: BLOK,
    week: 2,
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

function data(overrides: Partial<TodayData>): TodayData {
  return {
    latest: LATEST,
    sets: [],
    previousWeek: [],
    rides: [],
    nextStrength: null,
    nextRide: null,
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

test("strength day: exercises in sheet order, one per row, with last week's kg as reference", () => {
  const view = buildTodayView(
    data({
      sets: [
        set({ sheetRow: 27, setNo: 2, name: "Squat", setsText: "2", repsText: "5", prescribed: "-10%" }),
        set({ sheetRow: 25 }),
        set({ sheetRow: 27, setNo: 1, name: "Squat", setsText: "2", repsText: "5", prescribed: "-10%" }),
        set({ sheetRow: 31, name: "Dips", type: "BACK", repsText: "8 - 12", bodyweight: true }),
      ],
      previousWeek: [
        set({ week: 1, date: "2026-09-28", sheetRow: 25, loggedKg: 140 }),
        set({ week: 1, date: "2026-09-28", sheetRow: 27, loggedKg: 0 }),
        set({ week: 1, date: "2026-09-28", sheetRow: 31, loggedKg: 10, bodyweight: true }),
      ],
    }),
    "2026-10-05",
    NOW,
  );
  assert.equal(view.kind, "strength");
  const [session] = view.strength;
  assert.ok(session);
  assert.deepEqual([session.block, session.week], [BLOK, 2]);
  assert.deepEqual(
    session.exercises.map((e) => [e.name, e.setsText, e.repsText, e.prescribed, e.reference]),
    [
      ["Squat", "1", "3", "RPE 5.5", { kg: 140, bodyweight: false }],
      ["Squat", "2", "5", "-10%", null], // nothing logged last week
      ["Dips", "1", "8 - 12", "RPE 5.5", { kg: 10, bodyweight: true }],
    ],
  );
  assert.equal(view.header?.zone?.label, "Fresh");
  assert.equal(view.header?.freshness.kind, "fresh");
});

test("ride day, both, and rest day with the next session", () => {
  const ride = buildTodayView(data({ rides: [{ ...RIDE, date: "2026-10-05" }] }), "2026-10-05", NOW);
  assert.equal(ride.kind, "ride");
  assert.equal(ride.rides[0]?.steps[0]?.kind, "step");

  const both = buildTodayView(
    data({ sets: [set({})], rides: [{ ...RIDE, date: "2026-10-05" }] }),
    "2026-10-05",
    NOW,
  );
  assert.equal(both.kind, "both");

  const rest = buildTodayView(
    data({ nextStrength: set({ date: "2026-10-07", week: 2 }), nextRide: RIDE }),
    "2026-10-06",
    NOW,
  );
  assert.equal(rest.kind, "rest");
  assert.deepEqual(rest.next, { kind: "strength", date: "2026-10-07", block: BLOK, week: 2 });

  const rideFirst = buildTodayView(
    data({ nextStrength: set({ date: "2026-10-09" }), nextRide: RIDE }),
    "2026-10-06",
    NOW,
  );
  assert.deepEqual(rideFirst.next, { kind: "ride", date: "2026-10-08", name: "Zwift - Over-unders" });

  const nothing = buildTodayView(data({ latest: null }), "2026-10-06", NOW);
  assert.equal(nothing.next, null);
  assert.equal(nothing.header, null);
});

test("parsers for the Today rows", () => {
  const row = parsePrescribedSetRow({
    date: "2026-09-28",
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
  assert.equal(row.repsText, "8 - 12");

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
