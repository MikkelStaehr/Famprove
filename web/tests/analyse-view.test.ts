import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnalyseView,
  buildHero,
  deltaCopy,
  efTooFew,
  exclusionFacts,
  exclusionText,
  formatHours,
  seams,
  weekBars,
} from "../src/lib/analyse-view.ts";
import type { CyclingWeekRow, RideMetricsRow } from "../src/lib/db/rows.ts";

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
