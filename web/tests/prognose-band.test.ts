import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import {
  buildDashboardView,
  type ChartPoint,
  chartPoints,
  ctlBandArea,
  strengthUnknownFrom,
  visibleBand,
} from "../src/lib/dashboard-view.ts";
import { addDays } from "../src/lib/dates.ts";
import { illustrativeBands } from "../src/lib/db/dev-fixture.ts";
import {
  type Band,
  type DailyLoadRow,
  type DailyProjectionRow,
  type DashboardData,
  parseProjectionRow,
  type ProjectedSession,
} from "../src/lib/db/rows.ts";
import { formatLoad, formatSigned } from "../src/lib/format.ts";
import {
  BAND_LABEL,
  BAND_TEXT,
  PROGNOSE_TEXT,
  prognoseSentence,
  prognoseStatus,
  rangeText,
  strengthLine,
  strengthUnknownNote,
} from "../src/lib/prognose-text.ts";

const LAST = "2026-10-01";

function day(date: string): DailyLoadRow {
  return {
    date,
    cyclingTss: 0,
    strengthTss: 0,
    totalTss: 0,
    ctl: 40,
    atl: 42,
    tsb: -2,
    ctlRamp7d: 1,
    formZone: "grey_zone",
    computedAt: "2026-10-01T03:05:00Z",
  };
}

function session(overrides: Partial<ProjectedSession> = {}): ProjectedSession {
  return {
    session: 2,
    tss: 45.2,
    dayEstimated: false,
    reason: null,
    method: "plan",
    tssBand: null,
    recentWeeks: null,
    unscored: 0,
    ...overrides,
  };
}

function row(date: string, bands: Partial<Pick<DailyProjectionRow, "ctlBand" | "atlBand" | "tsbBand">>): DailyProjectionRow {
  return {
    date,
    cyclingTss: 0,
    strengthTss: 0,
    ctl: 46.3,
    atl: 44.1,
    tsb: -2.2,
    cyclingSource: "typical_week",
    typicalRides: null,
    rides: [],
    sessions: [],
    strengthMethod: "recent",
    ctlBand: null,
    atlBand: null,
    tsbBand: null,
    ...bands,
  };
}

function data(projection: readonly DailyProjectionRow[]): DashboardData {
  const daily = Array.from({ length: 10 }, (_, i) => day(addDays(LAST, i - 9)));
  return { daily, blocks: [], weeks: [], projection };
}

function fixtureRows(): DailyProjectionRow[] {
  const raw: unknown = JSON.parse(readFileSync(new URL("./fixtures/daily_projection.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(raw));
  return raw.map(parseProjectionRow);
}

test("§10f.3: the plotted CTL band is the stored low/high, unchanged; null or flat yields no band", () => {
  const ctl: Band = { low: 43.71, high: 49.38 };
  const atl: Band = { low: 40.6, high: 47.4 };
  const tsb: Band = { low: -6.2, high: 3.1 };
  const projection = [
    row(addDays(LAST, 1), { ctlBand: ctl, atlBand: atl, tsbBand: tsb }),
    row(addDays(LAST, 2), {}), // inside the block: all null
    row(addDays(LAST, 3), { ctlBand: { low: 46.3, high: 46.3 }, tsbBand: { low: -2.2, high: -2.2 } }), // flat
    row(addDays(LAST, 4), { ctlBand: { low: 46.2, high: 46.4 } }), // flat at whole TSS
  ];
  const points = chartPoints(data(projection), LAST).filter((p) => p.kind === "projected");
  assert.equal(points.length, 4);
  const [banded, none, flat, nearlyFlat] = points;
  assert.deepEqual(ctlBandArea(banded), [43.71, 49.38]);
  assert.equal(banded.bands?.ctl, ctl); // the same object: no widening, smoothing or rounding
  assert.equal(banded.bands?.atl, atl);
  assert.equal(banded.bands?.tsb, tsb);
  for (const p of [none, flat, nearlyFlat]) {
    assert.equal(ctlBandArea(p), null);
    assert.deepEqual(p.bands, { ctl: null, atl: null, tsb: null });
    assert.equal(rangeText(p.bands?.ctl ?? null, formatLoad), "");
    assert.equal(rangeText(p.bands?.tsb ?? null, formatSigned), "");
  }
  // Measured days never carry a band.
  const actual = chartPoints(data(projection), LAST).filter((p) => p.kind === "actual");
  assert.ok(actual.every((p) => p.bands === null && ctlBandArea(p) === null));
  assert.equal(visibleBand(null), null);
});

test("§10f.3 on Python's real output: plan rows have no band; banded rows come through unchanged", () => {
  const rows = fixtureRows();
  const points = chartPoints(data(rows), LAST).filter((p) => p.kind === "projected");
  assert.equal(points.length, rows.length);
  rows.forEach((r, i) => {
    const p = points[i];
    if (r.strengthMethod === "plan") assert.deepEqual(p.bands, { ctl: null, atl: null, tsb: null });
    for (const key of ["ctl", "atl", "tsb"] as const) {
      const stored = key === "ctl" ? r.ctlBand : key === "atl" ? r.atlBand : r.tsbBand;
      const shown = p.bands?.[key] ?? null;
      if (shown !== null) assert.equal(shown, stored);
      else assert.ok(stored === null || Math.round(stored.low) === Math.round(stored.high));
    }
  });
});

test("§10c: value ranges, incl. a negative TSB with U+2212 and 'til'", () => {
  assert.equal(rangeText({ low: 43.6, high: 49.2 }, formatLoad), " (44 til 49)");
  assert.equal(rangeText({ low: 40.8, high: 47.1 }, formatLoad), " (41 til 47)");
  assert.equal(rangeText({ low: -6.2, high: 3.1 }, formatSigned), " (−6 til +3)");
  assert.equal(rangeText({ low: 5.6, high: 5.7 }, formatLoad), "");
  assert.equal(rangeText(null, formatLoad), "");
});

test("§10c: tooltip status", () => {
  const estimate = (method: "plan" | "recent", dayEstimated: boolean): ChartPoint["estimate"] => ({
    cyclingTss: 0,
    cyclingSource: "typical_week",
    strengthTss: 0,
    rides: [],
    sessions: [session({ dayEstimated })],
    strengthMethod: method,
  });
  assert.equal(prognoseStatus(estimate("plan", false)), "Prognose");
  assert.equal(prognoseStatus(estimate("plan", true)), "Prognose · dag anslået");
  assert.equal(prognoseStatus(estimate("recent", false)), "Prognose · efter blokken");
  assert.equal(prognoseStatus(estimate("recent", true)), "Prognose · efter blokken · dag anslået");
  assert.equal(prognoseStatus(null), "Prognose");
});

test("§10f.4: strength lines verbatim", () => {
  assert.equal(strengthLine(session()), "Styrke ≈ 45 TSS · session 2 · fra trænerens plan");
  assert.equal(
    strengthLine(session({ dayEstimated: true, unscored: 2 })),
    "Styrke ≈ 45 TSS · session 2 · fra trænerens plan · dag anslået · 2 sæt uden kg ikke talt med",
  );
  assert.equal(
    strengthLine(session({ unscored: 1 })),
    "Styrke ≈ 45 TSS · session 2 · fra trænerens plan · 1 sæt uden kg ikke talt med",
  );
  const recent = { method: "recent", tss: 40.4, unscored: null, recentWeeks: 4, tssBand: { low: 29.8, high: 52.1 } } as const;
  assert.equal(
    strengthLine(session(recent)),
    "Styrke ≈ 40 TSS (30 til 52) · session 2 · gennemsnit af de seneste 4 uger",
  );
  assert.equal(
    strengthLine(session({ ...recent, recentWeeks: 1, tssBand: { low: 40, high: 40 }, dayEstimated: true })),
    "Styrke ≈ 40 TSS · session 2 · gennemsnit af den seneste uge · dag anslået",
  );
  const skipped = (reason: string | null) => strengthLine(session({ tss: null, reason, unscored: null }));
  assert.equal(skipped("no day left this week"), "Styrke · session 2 · ikke talt med (ingen dag tilbage i ugen)");
  assert.equal(
    skipped("no recent weeks to average"),
    "Styrke · session 2 · ikke talt med (endnu ingen hele uger at regne gennemsnit af)",
  );
  assert.equal(skipped("no kg for any set in the plan"), "Styrke · session 2 · ikke talt med (ingen kg i trænerens plan)");
  assert.equal(skipped("something new"), "Styrke · session 2 · ikke talt med");
  assert.equal(skipped(null), "Styrke · session 2 · ikke talt med");
});

test("§10b: the note names the first 'recent' date only when strength after the block is unknown", () => {
  const rows = fixtureRows();
  const points = chartPoints(data(rows), LAST);
  assert.equal(strengthUnknownFrom(points), "2026-10-12");
  assert.equal(
    strengthUnknownNote("2026-10-26"),
    "Styrke efter blokken (fra 26. okt.) er ikke med i prognosen endnu, fordi der ikke er nogen hele uger at regne et gennemsnit af. Den kommer med, når ugerne er gået.",
  );
  const known = rows.filter((r) => !r.sessions.some((s) => s.reason === "no recent weeks to average"));
  assert.equal(strengthUnknownFrom(chartPoints(data(known), LAST)), null);
});

test("§10d: the sr sentence, with and without a range", () => {
  const end = (ctlBand: Band | null): ChartPoint => {
    const p = chartPoints(data([{ ...row("2026-11-25", { ctlBand }), ctl: 48.2, atl: 40.1, tsb: 8.1 }]), LAST).at(-1);
    assert.ok(p !== undefined);
    return p;
  };
  assert.equal(
    prognoseSentence(end({ low: 44.2, high: 51.6 }), false),
    "Prognose, anslået ud fra trænerens plan og dine seneste uger: den ons. 25. nov. cirka fitness 48 (mellem 44 og 52), træthed 40, form plus 8.",
  );
  assert.equal(
    prognoseSentence(end({ low: 48.1, high: 48.3 }), true),
    "Prognose, anslået ud fra trænerens plan og dine seneste uger: den ons. 25. nov. cirka fitness 48, træthed 40, form plus 8. Styrke efter blokken er ikke med i prognosen endnu.",
  );
  assert.ok(!prognoseSentence(end(null), false).includes("mellem"));
});

test("§10f.5: disclosure copy verbatim", () => {
  assert.equal(
    PROGNOSE_TEXT,
    "Fitness, træthed og form de næste 8 uger, hvis du træner som du plejer. Cykling: dit gennemsnit for hver ugedag de sidste 28 dage (en planlagt tur erstatter dagen). Styrke: resten af blokken ud fra trænerens plan, og efter blokken dit gennemsnit pr. uge fra de seneste 4 hele uger uden deload. Det er et skøn, ikke en plan.",
  );
  assert.equal(BAND_LABEL, "Spænd efter blokken");
  assert.equal(
    BAND_TEXT,
    "Hvor fitness kan lande efter blokken, alt efter om dine styrkeuger bliver som den letteste eller den hårdeste af de seneste 4 hele uger. Jo længere frem, jo bredere.",
  );
});

test("§10f.1: 'ikke lavet før' is retired everywhere in web/src", () => {
  const root = new URL("../src/", import.meta.url);
  const files: URL[] = [];
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir));
      else files.push(url);
    }
  };
  walk(root);
  assert.ok(files.length > 0);
  for (const file of files) assert.ok(!readFileSync(file, "utf8").includes("ikke lavet før"), file.pathname);
});

test("§10e: DEV_FIXTURE=band spreads only 'recent' rows, low < value < high, growing", () => {
  const rows = fixtureRows();
  const banded = illustrativeBands(rows);
  rows.forEach((r, i) => {
    if (r.strengthMethod === "plan") assert.equal(banded[i], r);
  });
  const recent = banded.filter((r) => r.strengthMethod === "recent");
  assert.ok(recent.length > 1);
  let width = 0;
  for (const r of recent) {
    for (const [band, value] of [[r.ctlBand, r.ctl], [r.atlBand, r.atl], [r.tsbBand, r.tsb]] as const) {
      assert.ok(band !== null && band.low < value && value < band.high);
    }
    const w = (r.ctlBand?.high ?? 0) - (r.ctlBand?.low ?? 0);
    assert.ok(w > width);
    width = w;
    for (const s of r.sessions) {
      assert.equal(s.method, "recent");
      assert.equal(s.recentWeeks, 4);
      assert.ok(s.tss !== null && s.tssBand !== null && s.tssBand.low < s.tss && s.tss < s.tssBand.high);
    }
  }
  // Regression: each CTL edge must grow >= 0.2 CTL/row, or the band stays hidden under the 2.5px
  // CTL line (y axis ~±130 over ~150px at 390px: 1 CTL ~0.6px). 0.12/row was invisible.
  const first = recent[0];
  assert.ok(first !== undefined && first.ctlBand !== null);
  assert.ok(first.ctlBand.high - first.ctl >= 0.2 && first.ctl - first.ctlBand.low >= 0.2);
  const view = buildDashboardView(data(banded), new Date(`${LAST}T12:00:00Z`));
  assert.ok(view.kind === "ready" && view.chart.some((p) => ctlBandArea(p) !== null));
});

test("the prognose names its cycling basis and the hero its strength estimate", async () => {
  const { typicalRidesNote, STRENGTH_ESTIMATE_NOTE } = await import("../src/lib/prognose-text.ts");
  const { typicalRidesOf } = await import("../src/lib/dashboard-view.ts");
  assert.equal(typicalRidesNote(1), "Cyklingen i prognosen bygger på 1 tur de sidste 28 dage.");
  assert.equal(typicalRidesNote(4), "Cyklingen i prognosen bygger på 4 ture de sidste 28 dage.");
  assert.equal(typicalRidesNote(0), "Cyklingen i prognosen bygger på 0 ture de sidste 28 dage, så den regner kun med planlagte ture.");
  assert.equal(STRENGTH_ESTIMATE_NOTE, "Styrke-TSS er et skøn (K ukalibreret).");
  const raw: unknown = JSON.parse(readFileSync(new URL("./fixtures/daily_projection.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(raw));
  const rows = raw.map(parseProjectionRow);
  assert.ok(rows.some((r) => r.cyclingSource === "typical_week" && r.typicalRides === 1)); // Python's contract
  assert.ok(rows.every((r) => r.cyclingSource === "typical_week" || r.typicalRides === null));
  assert.equal(typicalRidesOf(rows), 1);
  assert.equal(typicalRidesOf(null), null);
  assert.equal(typicalRidesOf(rows.map((r) => ({ ...r, typicalRides: null }))), null);
  const first = raw.find((r: { basis: { cycling: string } }) => r.basis.cycling === "typical_week");
  for (const bad of [2.5, -1]) {
    assert.throws(() => parseProjectionRow({ ...first, basis: { ...first.basis, typical_rides: bad } }), /whole number/);
  }
});
