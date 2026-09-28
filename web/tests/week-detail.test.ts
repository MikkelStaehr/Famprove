import assert from "node:assert/strict";
import { test } from "node:test";

import { dayDetails, selectWeek, weekParam, weekView } from "../src/lib/dashboard-view.ts";
import { addDays } from "../src/lib/dates.ts";
import {
  parseActivityRow,
  parseStrengthSetRow,
  RowError,
} from "../src/lib/db/rows.ts";
import type {
  ActivityRow,
  DailyLoadRow,
  DashboardData,
  StrengthSetRow,
  WeeklyLoadRow,
} from "../src/lib/db/rows.ts";

function day(date: string, cyclingTss = 0, strengthTss = 0): DailyLoadRow {
  return {
    date,
    cyclingTss,
    strengthTss,
    totalTss: cyclingTss + strengthTss,
    ctl: 10,
    atl: 5,
    tsb: 5,
    ctlRamp7d: 0,
    formZone: "fresh",
    computedAt: "2026-09-28T03:00:00Z",
  };
}

function week(isoWeek: number, weekStart: string): WeeklyLoadRow {
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    isoYear: 2026,
    isoWeek,
    cyclingTss: 0,
    strengthTss: 0,
    totalTss: 0,
    days: 7,
  };
}

const DATA: DashboardData = {
  daily: [day("2026-09-14"), day("2026-09-21"), day("2026-09-28")],
  blocks: [],
  weeks: [week(39, "2026-09-21"), week(38, "2026-09-14"), week(40, "2026-09-28")],
};

function set(overrides: Partial<StrengthSetRow>): StrengthSetRow {
  return {
    date: "2026-08-10",
    block: "Program - blok 11",
    week: 1,
    sheetRow: 9,
    setNo: 1,
    type: "SQUAT",
    name: "Squat",
    reps: 5,
    loggedKg: 120,
    kg: 120,
    bodyweight: false,
    rpe: 7.5,
    prescribed: "RPE 7 - 8",
    score: 336.8,
    ...overrides,
  };
}

function ride(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: "i1",
    startDateLocal: "2026-08-10T18:05:00",
    type: "Ride",
    name: "Evening ride",
    movingTimeS: 3600,
    weightedAvgWatts: 250,
    intensityPct: 85.3,
    trainingLoad: 80,
    deviceName: "HAMMERHEAD Karoo",
    ...overrides,
  };
}

test("addDays crosses months and years in UTC", () => {
  assert.equal(addDays("2026-10-04", 1), "2026-10-05");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30"); // DST change in Copenhagen
});

test("weekParam pads the ISO week", () => {
  assert.equal(weekParam({ isoYear: 2026, isoWeek: 1 }), "2026-W01");
  assert.equal(weekParam({ isoYear: 2026, isoWeek: 40 }), "2026-W40");
});

test("selectWeek defaults to the latest week and links to neighbours", () => {
  const nav = selectWeek(DATA, "2026-09-28", undefined);
  assert.ok(nav);
  assert.equal(nav.param, "2026-W40");
  assert.equal(nav.isLatest, true);
  assert.equal(nav.prev, "2026-W39");
  assert.equal(nav.next, null);
});

test("selectWeek honours a known ?week= and ignores unknown or future ones", () => {
  const back = selectWeek(DATA, "2026-09-28", "2026-W38");
  assert.equal(back?.param, "2026-W38");
  assert.equal(back?.prev, null);
  assert.equal(back?.next, "2026-W39");
  assert.equal(back?.selected.days.length, 1);
  for (const bogus of ["2026-W41", "garbage", "2026-W4", "'; drop table"]) {
    assert.equal(selectWeek(DATA, "2026-09-28", bogus)?.param, "2026-W40");
  }
  // Latest data in week 39: week 40 exists but is "future" and can't be selected.
  assert.equal(selectWeek(DATA, "2026-09-21", "2026-W40")?.param, "2026-W39");
});

test("dayDetails: rest, ride only, counted strength, both, and plan-only strength", () => {
  const w = weekView(
    {
      daily: [
        day("2026-08-10", 80, 44.1),
        day("2026-08-11"),
        day("2026-08-12", 0, 23.9),
        day("2026-08-13", 60, 0),
        day("2026-08-14", 0, 0),
      ],
      blocks: [],
      weeks: [],
    },
    week(33, "2026-08-10"),
  );
  const detail = dayDetails(w, {
    activities: [ride({}), ride({ id: "i2", startDateLocal: "2026-08-13T07:00:00", deviceName: null })],
    sets: [
      set({ setNo: 2 }),
      set({ setNo: 1 }),
      set({ sheetRow: 12, name: "Dips", type: "BACK", bodyweight: true, loggedKg: 10, kg: 90, score: 264.6 }),
      set({ date: "2026-08-12", sheetRow: 17, name: "Tempo bench", type: "BENCH", score: 90.7 }),
      // Planned for the 14th, but that day carries no strength load: not shown.
      set({ date: "2026-08-14", sheetRow: 9 }),
    ],
  });
  const [mon, tue, wed, thu, fri] = detail;

  assert.equal(mon.rides.length, 1);
  assert.equal(mon.rides[0].startTime, "18:05");
  assert.ok(mon.strength);
  assert.equal(mon.strength.strengthTss, 44.1);
  assert.deepEqual(mon.strength.sessions, [{ block: "Program - blok 11", week: 1 }]);
  assert.deepEqual(
    mon.strength.exercises.map((e) => [e.name, e.sets, e.scorePerSet]),
    [
      ["Squat", 2, 336.8],
      ["Dips", 1, 264.6],
    ],
  );
  assert.equal(mon.rest, false);

  assert.equal(tue.rest, true);
  assert.equal(wed.rides.length, 0);
  assert.equal(wed.strength?.exercises[0]?.name, "Tempo bench");
  assert.equal(thu.strength, null);
  assert.equal(thu.rides[0]?.device, null);
  assert.equal(fri.rest, true);
});

test("parseActivityRow and parseStrengthSetRow map and validate", () => {
  assert.deepEqual(
    parseActivityRow({
      id: "i1",
      start_date_local: "2026-09-20T08:13:00",
      type: "Ride",
      name: null,
      moving_time_s: 5400,
      weighted_avg_watts: 231,
      intensity_pct: 79.4,
      training_load: 101,
      device_name: "HAMMERHEAD Karoo",
    }),
    {
      id: "i1",
      startDateLocal: "2026-09-20T08:13:00",
      type: "Ride",
      name: null,
      movingTimeS: 5400,
      weightedAvgWatts: 231,
      intensityPct: 79.4,
      trainingLoad: 101,
      deviceName: "HAMMERHEAD Karoo",
    },
  );
  const raw = {
    date: "2026-08-10",
    sheet_id: "s",
    block: "Program - blok 11",
    week: 1,
    sheet_row: 9,
    set_no: 1,
    type: "SQUAT",
    name: "Squat",
    reps: 5,
    logged_kg: 120,
    kg: 120,
    bodyweight: false,
    rpe: 7.49,
    prescribed: "RPE 7 - 8",
    score: 336.8,
  };
  assert.equal(parseStrengthSetRow(raw).prescribed, "RPE 7 - 8");
  assert.throws(() => parseStrengthSetRow({ ...raw, bodyweight: "no" }), RowError);
  assert.throws(() => parseActivityRow({ id: "i1", start_date_local: "yesterday" }), RowError);
});
