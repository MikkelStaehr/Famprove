import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { dayDetails, selectWeek, weekParam, weekView } from "../src/lib/dashboard-view.ts";
import { addDays } from "../src/lib/dates.ts";
import {
  parseActivityRow,
  parseAppNoticeRow,
  parseStrengthSetRow,
  RowError,
} from "../src/lib/db/rows.ts";
import type {
  ActivityRow,
  DailyLoadRow,
  DashboardData,
  StrengthSessionRow,
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
  projection: [],
  weeklyPlan: [],
};

function set(overrides: Partial<StrengthSetRow>): StrengthSetRow {
  return {
    weekStart: "2026-09-28",
    session: 1,
    block: "Program - blok 12",
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
    scoreFinal: overrides.score ?? 336.8, // unless a test says otherwise, compute changed nothing
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
    dataWarning: null,
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

function done(n: number, date: string, overrides: Partial<StrengthSessionRow> = {}): StrengthSessionRow {
  return {
    weekStart: "2026-09-28",
    session: n,
    block: "Program - blok 12",
    week: 1,
    activityId: `i${n}`,
    date,
    activityName: "Styrke",
    movingTimeS: 4368,
    tss: 44.1,
    ...overrides,
  };
}

test("dayDetails, week 40: Mon rest, Tue session 1 on its activity date, Wed ride only, extra on Thu", () => {
  const w = weekView(
    {
      daily: [
        day("2026-09-28"),
        day("2026-09-29", 0, 44.1),
        day("2026-09-30", 60, 0),
        day("2026-10-01"),
        day("2026-10-02"),
      ],
      blocks: [],
      weeks: [],
      projection: [],
      weeklyPlan: [],
    },
    week(40, "2026-09-28"),
  );
  const detail = dayDetails(w, {
    activities: [ride({ id: "i9", startDateLocal: "2026-09-30T07:00:00", deviceName: null })],
    rideVi: [{ activityId: "i9", vi: 1.18, viWarning: true }],
    sessions: [
      done(1, "2026-09-29"),
      done(4, "2026-10-01", { block: null, week: null, activityId: "x", movingTimeS: 2710, tss: 0 }),
    ],
    sets: [
      set({ setNo: 2 }),
      set({ setNo: 1 }),
      set({ sheetRow: 12, name: "Dips", type: "BACK", bodyweight: true, loggedKg: 10, kg: 90, score: 264.6 }),
      // Session 3 has kg pre-filled but no activity: it never shows.
      set({ session: 3, sheetRow: 40, name: "Dødløft", loggedKg: 125 }),
    ],
  });
  const [mon, tue, wed, thu, fri] = detail;

  assert.equal(mon.rest, true);
  assert.equal(mon.strength, null);

  assert.ok(tue.strength);
  assert.equal(tue.strength.strengthTss, 44.1);
  const [s1] = tue.strength.sessions;
  assert.deepEqual(
    [s1?.session, s1?.block, s1?.week, s1?.activityName, s1?.movingTimeS, s1?.tss],
    [1, "Program - blok 12", 1, "Styrke", 4368, 44.1],
  );
  assert.deepEqual(
    s1?.exercises.map((e) => [e.name, e.sets, e.scorePerSet]),
    [
      ["Squat", 2, 336.8],
      ["Dips", 1, 264.6],
    ],
  );
  // Effective kg (Python's strength_sets.kg) only where it differs from the logged kg.
  assert.deepEqual(
    s1?.exercises.map((e) => e.effectiveKg),
    [null, 90],
  );
  assert.equal(tue.rest, false);

  assert.equal(wed.strength, null); // no strength until intervals logs it
  assert.equal(wed.rides[0]?.device, null);
  assert.deepEqual([wed.rides[0]?.vi, wed.rides[0]?.viWarning], [1.18, true]); // Python's, as stored
  assert.equal(wed.rides[0]?.dataWarning, null); // no power-data warning on this ride
  assert.equal(wed.rest, false);

  const extra = thu.strength?.sessions[0];
  assert.deepEqual([extra?.block, extra?.tss, extra?.exercises.length], [null, 0, 0]);
  assert.equal(thu.rest, false);
  assert.equal(fri.rest, true);
});

test("effective kg: a bodyweight exercise with nothing logged shows its bodyweight share", () => {
  const w = weekView(
    { daily: [day("2026-09-29", 0, 10)], blocks: [], weeks: [], projection: [], weeklyPlan: [] },
    week(40, "2026-09-28"),
  );
  const [tue] = dayDetails(w, {
    activities: [],
    rideVi: [],
    sessions: [done(1, "2026-09-29")],
    sets: [
      set({ name: "Glute ham raise", type: "HAMSTRINGS", bodyweight: true, loggedKg: 0, kg: 51 }),
      set({ sheetRow: 10, name: "Pullups", bodyweight: true, loggedKg: null, kg: 85 }),
      set({ sheetRow: 11, name: "Facepulls", loggedKg: null, kg: 0 }), // blank: nothing to show
    ],
  });
  assert.deepEqual(
    tue.strength?.sessions[0]?.exercises.map((e) => [e.name, e.effectiveKg]),
    [
      ["Glute ham raise", 51],
      ["Pullups", 85],
      ["Facepulls", null],
    ],
  );
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
      data_warning: "Maks 1.700 W er over 1,3 × din ePmax (1.210 W).",
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
      dataWarning: "Maks 1.700 W er over 1,3 × din ePmax (1.210 W).",
    },
  );
  const raw = {
    week_start: "2026-09-28",
    session: 1,
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
    score_final: 223.2,
  };
  assert.equal(parseStrengthSetRow(raw).prescribed, "RPE 7 - 8");
  assert.equal(parseStrengthSetRow(raw).scoreFinal, 223.2);
  assert.equal(parseStrengthSetRow({ ...raw, score_final: null }).scoreFinal, null);
  const noFinal: Record<string, unknown> = { ...raw };
  delete noFinal.score_final;
  assert.throws(() => parseStrengthSetRow(noFinal), RowError); // selected column: never absent
  assert.equal(parseStrengthSetRow(raw).session, 1);
  assert.throws(() => parseStrengthSetRow({ ...raw, week_start: "2026-9-28" }), RowError);
  assert.throws(() => parseStrengthSetRow({ ...raw, bodyweight: "no" }), RowError);
  assert.throws(() => parseActivityRow({ id: "i1", start_date_local: "yesterday" }), RowError);
});

test("a ride without ride_metrics (before 2024-12-30) has no VI and no warning", () => {
  const w = weekView(
    { daily: [day("2026-09-30", 60, 0)], blocks: [], weeks: [], projection: [], weeklyPlan: [] },
    week(40, "2026-09-28"),
  );
  const [wed] = dayDetails(w, {
    activities: [ride({ id: "i9", startDateLocal: "2026-09-30T07:00:00" })],
    rideVi: [],
    sessions: [],
    sets: [],
  });
  assert.deepEqual([wed.rides[0]?.vi, wed.rides[0]?.viWarning], [null, false]);
});

test("app_notices rows parse; a notice without a message is rejected", () => {
  const row = { kind: "ftp_mismatch", date: "2026-10-13", message: "FTP er sat til 230 W, men dine ture peger på 183 W", updated_at: "2026-10-13T06:00:00+00:00" };
  assert.deepEqual(parseAppNoticeRow(row), { kind: row.kind, date: row.date, message: row.message, updatedAt: row.updated_at });
  assert.throws(() => parseAppNoticeRow({ ...row, message: null }), RowError);
});

test("contract: the power-check rows Python writes parse (fixtures/power_checks.json)", () => {
  const rows = JSON.parse(readFileSync(new URL("./fixtures/power_checks.json", import.meta.url), "utf-8")) as {
    activity: unknown;
    notice: unknown;
  };
  const ride = parseActivityRow(rows.activity);
  assert.match(ride.dataWarning ?? "", /^Maks 1\.650 W er over 1,3 × din ePmax \(1\.210 W\); Ét sample/);
  assert.deepEqual(parseAppNoticeRow(rows.notice), {
    kind: "ftp_mismatch",
    date: "2026-10-13",
    message: "FTP er sat til 230 W, men dine ture peger på 183 W",
    updatedAt: "2026-10-13T06:00:00+00:00",
  });
});

test("week view: the score per set is the final one that feeds the TSS; a null score_final is missing", () => {
  const w = weekView(
    { daily: [day("2026-09-28"), day("2026-09-29", 0, 7.0)], blocks: [], weeks: [], projection: [], weeklyPlan: [] },
    week(40, "2026-09-28"),
  );
  const detail = dayDetails(w, {
    activities: [],
    rideVi: [],
    sessions: [done(1, "2026-09-29")],
    sets: [
      set({ sheetRow: 30, name: "Bænk", type: "BENCH", score: 428.4, scoreFinal: 223.2 }), // rescored
      set({ sheetRow: 31, name: "Dips", type: "BACK", score: 128.6, scoreFinal: null }), // before the column
    ],
  });
  const [s1] = detail[1]?.strength?.sessions ?? [];
  // score_final null is missing (null), never the parser's score and never 0
  assert.deepEqual(s1?.exercises.map((e) => [e.name, e.scorePerSet]), [["Bænk", 223.2], ["Dips", null]]);
});
