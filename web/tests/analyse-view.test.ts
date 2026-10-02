import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  chartRows,
  EF_TREND_MIN_RIDES,
  efWindowRides,
  isEfRow,
  shownEfTrend,
  marksAt,
  buildAnalyseView,
  buildHero,
  deltaCopy,
  efTooFew,
  exclusionFacts,
  exclusionText,
  formatHours,
  formatKm,
  seams,
  weekBars,
} from "../src/lib/analyse-view.ts";
import type { CyclingWeekRow, RideMetricsRow } from "../src/lib/db/rows.ts";
import { parseRideMetricsRow } from "../src/lib/db/rows.ts";

const AT = "2026-10-01T03:00:00Z";

function ride(date: string, o: Partial<RideMetricsRow> = {}): RideMetricsRow {
  return {
    activityId: `i${date}`,
    date,
    type: "Ride",
    movingS: 3600,
    distanceM: 30000,
    load: 50,
    npW: 180,
    avgHr: 130,
    deviceWatts: true,
    ftpW: 250,
    ifSet: 0.7,
    rollingFtpW: null,
    ifEftp: null,
    ef: null,
    exclusion: null,
    eftpOk: false,
    eftpGapBefore: false,
    efOk: false,
    efTrend: null,
    efGapBefore: false,
    eftpYearAgoDate: null,
    eftpYearAgoW: null,
    eftpDeltaW: null,
    computedAt: AT,
    ...o,
  };
}

function week(weekStart: string, rides: number, o: Partial<CyclingWeekRow> = {}): CyclingWeekRow {
  return { weekStart, rides, movingS: rides * 3600, load: rides * 50, excluded: 0, computedAt: AT, ...o };
}

test("hero: the latest eftp_ok row, its delta passed through as delivered", () => {
  const rows = [
    ride("2026-09-10", { eftpOk: true, rollingFtpW: 190, eftpDeltaW: -10, eftpYearAgoW: 200, eftpYearAgoDate: "2025-09-08" }),
    ride("2026-09-15", { eftpOk: true, rollingFtpW: 184, eftpDeltaW: -49, eftpYearAgoW: 233, eftpYearAgoDate: "2025-09-12" }),
    ride("2026-09-20", { eftpOk: false, rollingFtpW: 300 }),
  ];
  const hero = buildHero(rows, 2026);
  assert.equal(hero.kind, "eftp");
  if (hero.kind !== "eftp") return;
  assert.equal(hero.value, "184 W");
  assert.equal(hero.dateText, "fra tirs. 15. sep.");
  assert.equal(hero.delta.text, "eFTP falder: −49 W på et år");
  assert.equal(hero.detail, "Samme tid sidste år: 233 W (fre. 12. sep. 2025)");
  assert.equal(hero.sr, "Estimeret FTP 184 watt den tirsdag 15. september. Et år før: 233 watt, minus 49 watt.");
});

test("hero: no eFTP", () => {
  const hero = buildHero([ride("2026-09-15")], 2026);
  assert.deepEqual(hero.kind, "none");
  assert.match(hero.sr, /^Ingen ture med watt siden 1\. jan\. 2025/);
});

test("delta copy variants (no arithmetic: the delivered value, rounded for display)", () => {
  assert.deepEqual(deltaCopy(12), { direction: "up", text: "eFTP stiger: +12 W på et år" });
  assert.deepEqual(deltaCopy(-49), { direction: "down", text: "eFTP falder: −49 W på et år" });
  assert.deepEqual(deltaCopy(0.2), { direction: "flat", text: "eFTP uændret på et år" });
  assert.deepEqual(deltaCopy(null), { direction: null, text: "Ingen eFTP fra samme tid sidste år at sammenligne med" });
});

test("exclusion copy and facts; an unknown code is never guessed", () => {
  assert.equal(exclusionText("too_short").short, "For kort");
  assert.equal(exclusionText("hr_outlier").eftp, false);
  assert.equal(exclusionText("no_raw").explanation, "Turens detaljer er ikke hentet endnu. Det daglige job henter dem.");
  assert.deepEqual(exclusionText("weird"), { short: "Udeladt", explanation: null, eftp: true, ef: true });
  assert.equal(exclusionFacts(ride("2026-01-01", { exclusion: "too_short", movingS: 240, distanceM: 800 })), "4 min · 0,8 km");
  assert.equal(exclusionFacts(ride("2026-01-01", { exclusion: "power_outlier", npW: 31, movingS: 5820 })), "NP 31 W · 1:37 t");
  assert.equal(exclusionFacts(ride("2026-01-01", { exclusion: "hr_outlier", avgHr: 212, movingS: null })), "puls 212");
  assert.equal(formatHours(2700), "45 min");
  assert.equal(formatHours(20), "under 1 min");
  assert.equal(formatHours(0), "0 min");
  assert.equal(formatKm(30), "under 0,1 km");
  assert.equal(formatKm(50), "0,1 km");
  assert.equal(formatKm(0), "0,0 km");
});

test("EF too few: 0, 1 and n, newest first with the year outside the current one", () => {
  assert.match(efTooFew([], 2026).text, /^Der er ingen rolige ture med både watt og puls siden 1\. jan\. 2025\. Trenden vises, når der er mindst 5\.$/);
  const one = efTooFew([ride("2025-06-03", { efOk: true, ef: 1.24 })], 2026);
  assert.equal(one.text, "Der er kun 1 rolig tur med både watt og puls siden 1. jan. 2025. Trenden vises fra 5.");
  assert.deepEqual(one.list, ["tirs. 3. jun. 2025 · EF 1,24"]);
  const three = efTooFew(
    ["2026-09-01", "2026-09-08", "2026-09-15"].map((d) => ride(d, { efOk: true, ef: 1.2 })),
    2026,
  );
  assert.match(three.text, /^Der er kun 3 rolige ture/);
  assert.equal(three.list[0], "tirs. 15. sep. · EF 1,20");
});

test("week rows: zero weeks are ticks, the current week is marked, tooltip copy", () => {
  const bars = weekBars([week("2025-06-02", 3, { excluded: 1, movingS: 16200, load: 210 }), week("2026-09-28", 0)], "2026-10-01", 0);
  assert.deepEqual(bars[0].tip, ["Uge 23 · 2.–8. jun. 2025", "3 ture · 4:30 t · 210 TSS", "1 udeladt fra trends"]);
  assert.equal(bars[0].zero, false);
  assert.equal(bars[1].zero, true);
  assert.equal(bars[1].current, true);
  assert.deepEqual(bars[1].tip, ["Uge 40 · 28. sep.–4. okt. · indtil videre", "Ingen ture"]);
});

test("seams: only runs of 4+ zero weeks", () => {
  const ws = [
    week("2025-01-06", 0), week("2025-01-13", 0), week("2025-01-20", 0),
    week("2025-01-27", 1),
    week("2025-02-03", 0), week("2025-02-10", 0), week("2025-02-17", 0), week("2025-02-24", 0),
  ];
  const s = seams(ws);
  assert.equal(s.length, 1);
});

test("page view: summary counts, sr sentences, freshness from the older table", () => {
  const rides = [
    ride("2025-09-12", { eftpOk: true, rollingFtpW: 233 }),
    ride("2025-09-20", { exclusion: "too_short", movingS: 240, distanceM: 800 }),
    ride("2026-03-10", { eftpOk: true, rollingFtpW: 181, eftpGapBefore: true }),
    ride("2026-09-15", { eftpOk: true, rollingFtpW: 184 }),
    ride("2026-09-16"),
  ];
  const view = buildAnalyseView(
    { rides, weeks: [week("2026-09-28", 0, { computedAt: "2026-09-27T03:00:00Z" })] },
    new Date("2026-10-01T06:00:00Z"),
    "2026-10-01",
  );
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  assert.equal(view.freshness.kind, "stale");
  assert.equal(view.excluded?.summary, "1 tur udeladt fra trends");
  assert.equal(view.excluded?.items[0].title, "lør. 20. sep. 2025 · For kort");
  assert.equal(view.noWattNote, "1 tur uden watt er ikke med her, men tæller i timer og belastning.");
  assert.equal(view.eftp?.segments, 2);
  assert.equal(
    view.eftp?.sr,
    "eFTP fra intervals.icu for 3 ture med watt fra 1. jan. 2025 til 1. okt. 2026. Seneste 184 W den 15. sep. 2026, højeste 233 W den 12. sep. 2025, laveste 181 W den 10. mar. 2026. Pause uden punkter fra 12. sep. 2025 til 10. mar. 2026. 1 tur er udeladt; se listen Udeladte ture.",
  );
  assert.equal(buildAnalyseView({ rides: [], weeks: [] }, new Date(AT), "2026-10-01").kind, "empty");
});

test("hero sr: no year-ago sentence without the year-ago date (the visible line is hidden too)", () => {
  const rows = [ride("2026-09-20", { eftpOk: true, rollingFtpW: 184, eftpYearAgoW: 233, eftpYearAgoDate: null, eftpDeltaW: -49 })];
  const hero = buildHero(rows, 2026);
  assert.ok(hero.kind === "eftp");
  assert.equal(hero.detail, null);
  assert.ok(!hero.sr.includes("Et år før"));
});

test("two rides on one day keep two marks, and the tooltip lists both", () => {
  const chart = {
    marks: [
      { x: 100, y: 1.2, trend: 1.15, seg: 0, latest: false, excluded: false, tip: ["a"] },
      { x: 100, y: 1.3, trend: 1.16, seg: 0, latest: false, excluded: false, tip: ["b"] },
      { x: 104, y: null, trend: null, seg: 0, latest: false, excluded: true, tip: ["c"] },
    ],
    segments: 1,
    domain: [1, 1.5] as const,
    ticks: [1, 1.5],
    sr: "",
  };
  const rows = chartRows(chart, "ef");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((r) => r.x === 100).map((r) => r.dots), [1.2, 1.3]);
  assert.deepEqual(rows.filter((r) => r.x === 100).map((r) => r.s0), [1.15, 1.16]);
  assert.deepEqual(marksAt(rows, 100).flatMap((m) => m.tip), ["a", "b"]);
  const excluded = rows.find((r) => r.x === 104);
  assert.ok(excluded !== undefined && excluded.excl === 1 && excluded.dots === null && excluded.s0 === undefined);
  assert.deepEqual(chartRows({ ...chart, marks: chart.marks.slice(0, 1) }, "eftp")[0]?.s0, 1.2);
});

test("EF line breaks: a gap or a hidden trend starts a new segment; dots always stay", () => {
  const ef = (date: string, o: Partial<RideMetricsRow> = {}) =>
    ride(date, { efOk: true, eftpOk: true, ef: 1.2, efTrend: 1.2, efGapBefore: false, ...o });
  const rides = [
    ef("2026-05-01", { efGapBefore: true }), // n 1: dot, no trend
    ef("2026-05-05"), // n 2: dot, no trend
    ef("2026-05-08"), // n 3: the trend starts
    ef("2026-05-12"), // n 4
    ef("2026-05-14", { efTrend: null }), // Python's null trend still breaks the line
    ef("2026-05-16"), // n 6: trend again, a new segment
    ef("2026-07-01", { efGapBefore: true }), // n 1 after a gap: dot only
  ];
  const v = buildAnalyseView({ rides, weeks: [], weeksError: null }, new Date("2026-10-01T06:00:00Z"), "2026-10-01");
  assert.ok(v.kind === "ready" && "marks" in v.ef);
  const marks = v.ef.marks.filter((m) => !m.excluded);
  assert.equal(marks.length, 7); // every EF ride keeps its dot
  assert.deepEqual(marks.map((m) => m.trend), [null, null, 1.2, 1.2, null, 1.2, null]);
  assert.deepEqual(marks.map((m) => m.seg), [0, 0, 0, 0, 1, 1, 2]);
  assert.ok(marks[0]?.tip.every((line) => !line.startsWith("Trend")));
});

test("the EF trend needs 3 EF rides in the 28 days ending on the ride (Python's window)", () => {
  const ef = (date: string) => ride(date, { efOk: true, ef: 1.2, efTrend: 1.25 }) as Parameters<typeof shownEfTrend>[0];
  const edge = [ef("2026-05-01"), ef("2026-05-10"), ef("2026-05-28")]; // 05-01 is day 28 back from 05-28
  assert.equal(shownEfTrend(edge[2] as Parameters<typeof shownEfTrend>[0], edge), 1.25);
  const outside = [ef("2026-04-30"), ef("2026-05-10"), ef("2026-05-28")]; // 29 days back: not counted
  assert.equal(shownEfTrend(outside[2] as Parameters<typeof shownEfTrend>[0], outside), null);
  const later = [...edge, ef("2026-06-30")];
  assert.equal(shownEfTrend(later[0] as Parameters<typeof shownEfTrend>[0], later), null); // only rides up to its own day count
  assert.equal(EF_TREND_MIN_RIDES, 3);
});

// Contract (CLAUDE.md): web/tests/fixtures/ef_window.json is Python's own output
// (python/tests/test_contract_ef_window.py): ride_metrics rows + Python's ef_window count per EF
// ride. The web's count must match it exactly, so the two windows can't drift apart.
test("contract: the web's EF-ride count equals Python's ef_window on Python's rows", () => {
  const doc: unknown = JSON.parse(readFileSync(new URL("./fixtures/ef_window.json", import.meta.url), "utf8"));
  assert.ok(typeof doc === "object" && doc !== null && "rows" in doc && "counts" in doc);
  const { rows: raw, counts } = doc;
  assert.ok(Array.isArray(raw) && typeof counts === "object" && counts !== null);
  const rows = raw.map(parseRideMetricsRow);
  const points = rows.filter(isEfRow);
  const expected = new Map(Object.entries(counts));
  assert.equal(points.length, expected.size);
  assert.ok(expected.size >= 8);
  for (const p of points) {
    const n = expected.get(p.activityId);
    assert.equal(efWindowRides(p, points), n, `EF rides in the window of ${p.activityId}`);
    assert.equal(shownEfTrend(p, points), typeof n === "number" && n >= EF_TREND_MIN_RIDES ? p.efTrend : null);
  }
  assert.ok(rows.some((r) => !isEfRow(r)), "non-EF rows are in the fixture and never counted");
});
