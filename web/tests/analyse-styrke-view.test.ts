import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockSpans,
  buildBoard,
  buildStyrkeView,
  kgDomain,
  latestBlockNo,
  monthTicks,
  NOTE_ESTIMATE,
  NOTE_PRESCRIBED,
  phaseSentence,
  RPE_LINE,
  sheetOneRm,
  strengthWeeks,
} from "../src/lib/analyse-styrke-view.ts";
import { dayNumber } from "../src/lib/dates.ts";
import type { StrengthAnalysisData, StrengthBlockRow, StrengthLift, StrengthWeekRow } from "../src/lib/db/rows.ts";

const TODAY = "2026-10-01"; // Thursday; ISO week starts 2026-09-28
const NOW = new Date("2026-10-01T06:00:00Z");
const AT = "2026-10-01T03:00:00Z";

function row(weekStart: string, lift: StrengthLift, o: Partial<StrengthWeekRow> = {}): StrengthWeekRow {
  return {
    weekStart,
    lift,
    block: "Program - blok 12",
    blockNo: 12,
    phase: "off_season",
    status: "lifted",
    setsLifted: 10,
    tonnageKg: 2100,
    e1rmKg: null,
    e1rmLoadKg: null,
    e1rmReps: null,
    e1rmRpe: null,
    e1rmRpeSource: null,
    isBlockBest: false,
    computedAt: AT,
    ...o,
  };
}

const e1rm = (kg: number, best = false, source: "logged" | "prescribed" = "prescribed"): Partial<StrengthWeekRow> => ({
  e1rmKg: kg,
  e1rmLoadKg: 140,
  e1rmReps: 5,
  e1rmRpe: 6.5,
  e1rmRpeSource: source,
  isBlockBest: best,
});

const B11 = { block: "Program - blok 11", blockNo: 11, phase: "in_season", status: "pre_log" } as const;
const GAP = { block: null, blockNo: null, phase: null, status: null, setsLifted: 0, tonnageKg: 0 } as const;

const BLOCKS: StrengthBlockRow[] = [
  { name: "Program - blok 11", blockNo: 11, startDate: "2026-08-10", endDate: "2026-08-17", deloadStart: "2026-08-17", phase: "in_season" },
  { name: "Program - blok 12", blockNo: 12, startDate: "2026-09-21", endDate: null, deloadStart: null, phase: "off_season" },
];

function weeks(): StrengthWeekRow[] {
  return [
    row("2026-08-10", "SQUAT", { ...B11, ...e1rm(175) }),
    row("2026-08-10", "BENCH", { ...B11 }),
    row("2026-08-10", "DEADLIFT", { ...B11, status: null, setsLifted: 0, tonnageKg: 0 }),
    row("2026-08-17", "SQUAT", { ...B11, ...e1rm(179.6, true) }),
    row("2026-08-17", "BENCH", { ...B11 }),
    row("2026-08-17", "DEADLIFT", { ...B11 }),
    row("2026-08-24", "SQUAT", GAP),
    row("2026-08-24", "BENCH", GAP),
    row("2026-08-24", "DEADLIFT", GAP),
    row("2026-09-21", "SQUAT", e1rm(174.1, true)),
    row("2026-09-21", "BENCH", e1rm(106.2, true)),
    row("2026-09-21", "DEADLIFT", e1rm(170)),
    row("2026-09-28", "SQUAT", e1rm(172)),
    row("2026-09-28", "BENCH", { tonnageKg: 14008.4 }),
    row("2026-09-28", "DEADLIFT", e1rm(174.1, true)),
  ];
}

const SHEET: StrengthAnalysisData["sheetOneRm"] = [
  { block: "Program - blok 12", lift: "SQUAT", kg: 180 },
  { block: "Program - blok 12", lift: "SQUAT", kg: 180 },
  { block: "Program - blok 12", lift: "BENCH", kg: 102.5 },
  { block: "Program - blok 12", lift: "DEADLIFT", kg: 180 },
  { block: "Program - blok 12", lift: "DEADLIFT", kg: 185 },
];

const data = (w = weeks()): StrengthAnalysisData => ({ weeks: w, blocks: BLOCKS, sheetOneRm: SHEET });

function ready(d = data()) {
  const v = buildStyrkeView(d, NOW, TODAY);
  assert.equal(v.kind, "ready");
  if (v.kind !== "ready") throw new Error("not ready");
  return v;
}

test("no rows is the page-empty state", () => {
  assert.deepEqual(buildStyrkeView({ weeks: [], blocks: [], sheetOneRm: [] }, NOW, TODAY), { kind: "empty" });
});

test("latest block is the highest block_no with rows", () => {
  assert.equal(latestBlockNo(weeks()), 12);
  assert.equal(latestBlockNo([row("2026-08-24", "SQUAT", GAP)]), null);
});

test("lift board: block-best rows of the latest block, SBD order, prescribed muted, no delta", () => {
  const b = buildBoard(weeks(), BLOCKS, 12);
  assert.equal(b.label, "Bedste e1RM · blok 12");
  assert.equal(b.phase, "uden for sæson");
  assert.deepEqual(
    b.rows.map((r) => [r.name, r.value, r.logged]),
    [
      ["Squat", "174,1 kg", false],
      ["Bænkpres", "106,2 kg", false],
      ["Dødløft", "174,1 kg", false],
    ],
  );
  assert.deepEqual(b.rows[0].lines, ["140 kg × 5 · RPE 6,5 · uge 1", "baseret på foreskrevet RPE"]);
  assert.equal(b.rows[2].lines[0], "140 kg × 5 · RPE 6,5 · uge 2");
  assert.equal(b.firstNote, "Blok 12 er den første blok uden for sæson, så der er ingen blok at sammenligne med endnu.");
  assert.equal(
    b.sr,
    "Bedste estimerede 1RM i blok 12, uden for sæson: squat 174,1 kilo, bænkpres 106,2 kilo, dødløft 174,1 kilo. Alle tre er baseret på foreskrevet RPE.",
  );
});

test("lift board: logged rows turn ink and the sr names them", () => {
  const w = weeks().map((r) => (r.weekStart === "2026-09-21" && r.lift === "SQUAT" ? { ...r, e1rmRpeSource: "logged" as const } : r));
  const b = buildBoard(w, BLOCKS, 12);
  assert.equal(b.rows[0].logged, true);
  assert.equal(b.rows[0].lines[1], "logget RPE");
  assert.match(b.sr, /Squat er baseret på logget RPE, de andre på foreskrevet\.$/);
});

test("lift board: no block best gives a dash and the 'Intet e1RM' line", () => {
  const w = weeks().filter((r) => !(r.blockNo === 12 && r.lift === "BENCH"));
  const b = buildBoard(w, BLOCKS, 12);
  assert.equal(b.rows[1].value, "–");
  assert.deepEqual(b.rows[1].lines, ["Intet e1RM i blok 12 endnu"]);
  assert.match(b.sr, /bænkpres ikke registreret/);
});

test("lift board: an earlier block in the same phase is shown as a reference, not a delta", () => {
  const blocks: StrengthBlockRow[] = [
    ...BLOCKS,
    { name: "Program - blok 13", blockNo: 13, startDate: "2026-09-28", endDate: null, deloadStart: null, phase: "off_season" },
  ];
  const w = [...weeks(), row("2026-09-28", "SQUAT", { block: "Program - blok 13", blockNo: 13, ...e1rm(176, true) })];
  const b = buildBoard(w, blocks, 13);
  assert.deepEqual(b.rows[0].lines.at(-1), "Blok 12: 174,1 kg");
  assert.equal(b.firstNote, null);
});

test("sheet 1RM: one distinct value per block and lift, else no line and a warning", () => {
  assert.deepEqual(sheetOneRm(SHEET, "Program - blok 12", "SQUAT"), { kg: 180, warning: null });
  const two = sheetOneRm(SHEET, "Program - blok 12", "DEADLIFT");
  assert.equal(two.kg, null);
  assert.match(two.warning ?? "", /2 distinct/);
  const none = sheetOneRm(SHEET, "Program - blok 11", "SQUAT");
  assert.equal(none.kg, null);
  assert.match(none.warning ?? "", /0 distinct/);
});

test("e1RM panels: prescribed vs logged points, block bests labelled, a line per block", () => {
  const v = ready();
  assert.ok(v.panels !== null);
  const [squat, bench, dl] = v.panels ?? [];
  assert.equal(squat.points.length, 4);
  assert.equal(bench.points.length, 1);
  assert.equal(dl.points.length, 2);
  assert.deepEqual(
    squat.points.map((p) => p.label),
    [null, "179,6", "174,1", null],
  );
  // Two segments (blok 11, blok 12): the line breaks at the block boundary.
  assert.equal(squat.segments.length, 2);
  assert.ok(squat.points.every((p) => !p.logged));
  assert.deepEqual(squat.sheet.map((s) => s.label), ["180"]);
  assert.deepEqual(bench.sheet.map((s) => s.label), ["102,5"]);
  assert.deepEqual(dl.sheet, []); // 2 distinct values -> no line
  assert.ok(v.warnings.length >= 1);
  assert.equal(
    squat.sr,
    "Squat: 4 uger med e1RM fra 10. aug. til 28. sep. Bedst i blok 11 (i sæson): 179,6 kilo. Bedst i blok 12 (uden for sæson): 174,1 kilo. 1RM i arket, ikke testet: 180 kilo.",
  );
  assert.equal(v.phaseSr, "Faseskift fra i sæson til uden for sæson den 21. sep.");
});

test("e1RM: a lift without points gets the panel message; no points anywhere -> no panels", () => {
  const w = weeks().map((r) => (r.lift === "BENCH" ? { ...r, e1rmKg: null, isBlockBest: false } : r));
  const v = ready(data(w));
  assert.equal(v.panels?.[1].empty, "Intet e1RM endnu for bænkpres.");
  const none = ready(data(weeks().map((r) => ({ ...r, e1rmKg: null, isBlockBest: false }))));
  assert.equal(none.panels, null);
  assert.ok(!none.notes.includes(NOTE_PRESCRIBED));
});

test("kg domain rounds out to 5 kg with 2-3 ticks", () => {
  const d = kgDomain([172, 179.6, 180]);
  assert.ok(d.domain[0] <= 170 && d.domain[1] >= 180);
  assert.ok(d.ticks.length >= 2 && d.ticks.length <= 3);
  assert.ok(d.ticks.every((t) => t % 5 === 0));
});

test("block ruler: spans to end + 7 days, ongoing to the current week, deload hatch, phase rule", () => {
  const v = ready();
  const lo = dayNumber("2026-08-10") - 0.5;
  assert.equal(v.lo, lo);
  assert.equal(v.hi, dayNumber("2026-10-04") + 0.5);
  assert.deepEqual(blockSpans(BLOCKS, v.lo, v.hi), [
    { x0: lo, x1: dayNumber("2026-08-24") - 0.5, label: "Blok 11", deloadX0: dayNumber("2026-08-17") - 0.5 },
    { x0: dayNumber("2026-09-21") - 0.5, x1: v.hi, label: "Blok 12", deloadX0: null },
  ]);
  assert.deepEqual(v.phaseRules, [dayNumber("2026-09-21") - 0.5]);
  assert.equal(v.hasDeload, true);
});

test("month ticks: month starts, year on January and on a first tick outside the current year", () => {
  assert.deepEqual(
    monthTicks(dayNumber("2026-08-10"), dayNumber("2026-10-04"), TODAY).map((t) => t.label),
    ["sep.", "okt."],
  );
  assert.deepEqual(
    monthTicks(dayNumber("2025-11-10"), dayNumber("2026-02-04"), TODAY).map((t) => t.label),
    ["dec. 2025", "jan. 2026", "feb."],
  );
});

test("weeks: zero weeks stay visible, gap weeks read 'mellem blokke', tooltips and sr rows", () => {
  const w = strengthWeeks(weeks(), BLOCKS, TODAY, dayNumber("2026-08-10") - 0.5);
  assert.equal(w.length, 5);
  const [first, deload, gap, b12w1, current] = w;
  assert.equal(first.head, "Uge 33 · 10.–16. aug. · blok 11, uge 1 · før aktivitetslog");
  assert.equal(deload.head, "Uge 34 · 17.–23. aug. · blok 11, uge 2 · deload · før aktivitetslog");
  assert.equal(gap.head, "Uge 35 · 24.–30. aug. · mellem blokke");
  assert.deepEqual(gap.tonnage, [0, 0, 0]);
  assert.deepEqual(gap.srRow.slice(1), ["mellem blokke", "0", "0", "0"]);
  assert.equal(first.e1rmTip[2], "Dødløft: ikke trænet");
  assert.equal(first.e1rmTip[1], "Bænkpres: intet tungt sæt med RPE");
  assert.equal(b12w1.e1rmTip[0], "Squat: 174,1 kg · 140 kg × 5 · RPE 6,5 foreskrevet · bedst i blokken");
  assert.equal(b12w1.tonnageTip[0], "Squat: 2.100 kg · 10 sæt");
  assert.equal(current.current, true);
  assert.match(current.head, / · indtil videre$/);
  assert.equal(current.srRow[3], "14.008");
});

test("notes: prescribed, phases, pre_log and the estimate note; RPE line until something is logged", () => {
  const v = ready();
  assert.deepEqual(v.notes, [
    NOTE_PRESCRIBED,
    "Blok 11 er i sæson, blok 12 uden for sæson. Den lodrette streg er faseskiftet: sammenlign blokke i samme fase.",
    "Blok 11 er fra før aktivitetsloggen. Dens uger tæller med, når ugen er slut, ikke når en session registreres.",
    NOTE_ESTIMATE,
  ]);
  assert.equal(v.rpeLine, RPE_LINE);
  const logged = ready(data(weeks().map((r) => (r.e1rmKg !== null ? { ...r, e1rmRpeSource: "logged" as const } : r))));
  assert.equal(logged.rpeLine, null);
  assert.ok(!logged.notes.includes(NOTE_PRESCRIBED));
});

test("phase sentence groups consecutive blocks of one phase", () => {
  const blocks: StrengthBlockRow[] = [
    ...BLOCKS,
    { name: "Program - blok 13", blockNo: 13, startDate: "2026-10-19", endDate: null, deloadStart: null, phase: "off_season" },
  ];
  assert.equal(phaseSentence(blocks), "Blok 11 er i sæson, blok 12–13 uden for sæson.");
});

test("freshness is the latest computed_at; older than 26 h is stale", () => {
  assert.equal(ready().freshness.kind, "fresh");
  const old = weeks().map((r) => ({ ...r, computedAt: "2026-09-28T03:00:00Z" }));
  assert.equal(ready(data(old)).freshness.kind, "stale");
});
