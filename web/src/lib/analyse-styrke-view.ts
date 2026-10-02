/**
 * View model for /analyse/styrke (design/specs/analyse-styrke.md). Pure; unit-tested with node --test.
 * Every number is Python's (strength_weeks, blocks, the sheet's 1RM). Allowed here: selecting rows
 * (latest block, block best, the sheet 1RM per block and lift), counting rows, date -> x, choosing
 * a y domain, and formatting. No deltas, no sums, no block totals.
 */
import { addDays, dayNumber, isoWeekNumber, isoWeekStart } from "./dates.ts";
import { type Freshness, freshness } from "./dashboard-view.ts";
import type {
  IsoDate,
  StrengthAnalysisData,
  StrengthBlockRow,
  StrengthPhase,
  StrengthWeekRow,
} from "./db/rows.ts";
import { formatDate, formatDateRange, formatKg, LOCALE, stopAfter } from "./format.ts";
import { LIFT_NAME, LIFTS, perLift, type StrengthLift } from "./lifts.ts";

/** The e1RM panels' height: the client chart's hydration skeleton and loading.tsx share it. */
export const E1RM_PANELS_HEIGHT = "h-[492px]";

/** A week row with an e1RM (and, for block bests, a block). */
type E1rmRow = StrengthWeekRow & { readonly e1rmKg: number };
const hasE1rm = (w: StrengthWeekRow): w is E1rmRow => w.e1rmKg !== null;
type BlockRow = StrengthWeekRow & { readonly blockNo: number };
const inBlock = (w: StrengthWeekRow): w is BlockRow => w.blockNo !== null;

const dated = (date: IsoDate): string => `${formatDate(date)}${stopAfter(formatDate(date))}`;

const liftLower = (l: StrengthLift): string => LIFT_NAME[l].toLowerCase();
export const PHASE_TEXT: Readonly<Record<StrengthPhase, string>> = { in_season: "i sæson", off_season: "uden for sæson" };

export const NOTE_PRESCRIBED = "Lyse punkter er baseret på foreskrevet RPE. Log RPE på topsættet, så tæller punktet fuldt.";
export const NOTE_ESTIMATE = "e1RM er et skøn ud fra ugens bedste tunge sæt (kg, reps og RPE), ikke et testet maks.";
export const NO_E1RM = "Der er intet e1RM endnu. Det kommer, når et tungt sæt med RPE er løftet.";
export const RPE_LINE = "Udviklingen i RPE kommer, når du har logget RPE på topsæt i nogle uger.";
export const TONNAGE_EXPLAINER = "Kg × reps for alle løftede sæt af løftet, også varianter.";
export const MISSING = "–";

// --- formatting ----------------------------------------------------------------------------

const E1RM = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const RPE = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** "174,1" (1 decimal, spec top). */
export const formatE1rm = (kg: number): string => E1RM.format(kg);
/** "14.008" (whole kg, display rounding only). */
export const formatTonnage = (kg: number): string => WHOLE.format(kg);
/** "6,5" / "8". */
export const formatRpe = (rpe: number): string => RPE.format(rpe);

const yearOf = (date: IsoDate): number => Number(date.slice(0, 4));
const blockLabel = (no: number): string => `blok ${no}`;
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Squat og bænkpres", "squat, bænkpres og dødløft". */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} og ${words[words.length - 1]}`;
}

/** Block numbers as runs: [11] -> "11", [12, 13] -> "12–13", [10, 12] -> "10 og 12". */
function blockNumbers(nos: readonly number[]): string {
  const sorted = [...new Set(nos)].sort((a, b) => a - b);
  const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (sorted.length > 1 && consecutive) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return listWords(sorted.map(String));
}

/** "140 kg × 5 · RPE 6,5": the set behind an e1RM, missing parts left out. */
function setText(r: StrengthWeekRow): string {
  const parts: string[] = [];
  if (r.e1rmLoadKg !== null) parts.push(r.e1rmReps === null ? `${formatKg(r.e1rmLoadKg)} kg` : `${formatKg(r.e1rmLoadKg)} kg × ${r.e1rmReps}`);
  if (r.e1rmRpe !== null) parts.push(`RPE ${formatRpe(r.e1rmRpe)}`);
  return parts.join(" · ");
}

// --- types ---------------------------------------------------------------------------------

export type AxisTick = { readonly x: number; readonly label: string };

export type BlockSpan = {
  readonly x0: number;
  readonly x1: number;
  readonly blockNo: number;
  readonly label: string; // "Blok 11"
  readonly deloadX0: number | null; // hatch from here to x1
};

export type BoardRow = {
  readonly lift: StrengthLift;
  readonly name: string;
  readonly value: string; // "174,1 kg" or "–"
  readonly logged: boolean; // ink (logged RPE) vs muted
  readonly lines: readonly string[]; // the set, the RPE source, the earlier same-phase block
};

export type LiftBoard = {
  readonly label: string; // "Bedste e1RM · blok 12"
  readonly phase: string | null; // "uden for sæson"
  readonly rows: readonly BoardRow[];
  readonly firstNote: string | null; // "Blok 12 er den første blok uden for sæson, …"
  readonly sr: string;
};

export type E1rmPoint = {
  readonly x: number;
  readonly y: number;
  readonly logged: boolean;
  readonly best: boolean;
  readonly label: string | null; // "179,6" on block bests only
  readonly labelBelow: boolean; // the point is below its block's sheet line: label under the ring
};

export type SheetLine = { readonly x0: number; readonly x1: number; readonly y: number; readonly label: string };

export type E1rmPanel = {
  readonly lift: StrengthLift;
  readonly name: string;
  readonly empty: string | null; // "Intet e1RM endnu for squat."
  readonly points: readonly E1rmPoint[];
  readonly segments: readonly (readonly E1rmPoint[])[]; // one per block, >= 2 points
  readonly sheet: readonly SheetLine[];
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly sr: string;
};

export type StrengthWeek = {
  readonly x0: number;
  readonly x1: number;
  readonly current: boolean;
  readonly head: string; // tooltip line 1
  readonly e1rmTip: readonly string[];
  readonly tonnageTip: readonly string[];
  readonly tonnage: Readonly<Record<StrengthLift, number | null>>; // 0 = nothing lifted; null = row missing
  readonly srRow: readonly [string, string, string, string, string];
};

export type StyrkeView =
  | { readonly kind: "empty" }
  | {
      readonly kind: "ready";
      readonly freshness: Freshness;
      readonly lo: number;
      readonly hi: number;
      readonly ticksNarrow: readonly AxisTick[];
      readonly ticksWide: readonly AxisTick[];
      readonly blocks: readonly BlockSpan[];
      readonly phaseRules: readonly number[];
      readonly board: LiftBoard;
      readonly panels: readonly E1rmPanel[] | null; // null: no e1RM for any lift
      readonly hasSheet: boolean;
      readonly hasDeload: boolean;
      readonly notes: readonly string[];
      readonly phaseSr: string | null;
      readonly weeks: readonly StrengthWeek[];
      readonly tonnageMax: Readonly<Record<StrengthLift, number>>;
      readonly rpeLine: string | null;
      readonly warnings: readonly string[]; // console.warn on the server (sheet 1RM ambiguity)
    };

// --- selection -----------------------------------------------------------------------------

/** Latest block = the highest block_no with any strength_weeks row (spec §4), even in a gap week. */
export function latestBlockNo(weeks: readonly StrengthWeekRow[]): number | null {
  return weeks.reduce<number | null>((a, w) => (w.blockNo !== null && (a === null || w.blockNo > a) ? w.blockNo : a), null);
}

const bestRow = (weeks: readonly StrengthWeekRow[], blockNo: number, lift: StrengthLift): StrengthWeekRow | undefined =>
  weeks.find((w) => w.blockNo === blockNo && w.lift === lift && w.isBlockBest && w.e1rmKg !== null);

/** The week number inside its block, counted from the block's rows (1-based). */
function blockWeekOf(weeks: readonly StrengthWeekRow[], blockNo: number, weekStart: IsoDate): number {
  const starts = [...new Set(weeks.filter((w) => w.blockNo === blockNo).map((w) => w.weekStart))].sort();
  return starts.indexOf(weekStart) + 1;
}

function phaseOfBlock(blocks: readonly StrengthBlockRow[], weeks: readonly StrengthWeekRow[], blockNo: number): StrengthPhase | null {
  return blocks.find((b) => b.blockNo === blockNo)?.phase ?? weeks.find((w) => w.blockNo === blockNo)?.phase ?? null;
}

/**
 * The sheet's 1RM for (block, lift): the single distinct value, else null and a warning
 * (0 or >= 2 distinct values: no line, never a guess; spec intro).
 */
export function sheetOneRm(
  rows: StrengthAnalysisData["sheetOneRm"],
  block: string,
  lift: StrengthLift,
): { readonly kg: number | null; readonly warning: string | null } {
  const values = [...new Set(rows.filter((r) => r.block === block && r.lift === lift).map((r) => r.kg))];
  if (values.length === 1) return { kg: values[0], warning: null };
  return {
    kg: null,
    warning: `analyse/styrke: ${values.length} distinct sheet 1RM values for ${lift} in "${block}"; no reference line`,
  };
}

// --- hero (spec §4, §7) --------------------------------------------------------------------

export function buildBoard(weeks: readonly StrengthWeekRow[], blocks: readonly StrengthBlockRow[], latest: number): LiftBoard {
  const phase = phaseOfBlock(blocks, weeks, latest);
  let anyEarlier = false;
  const rows: BoardRow[] = LIFTS.map((lift) => {
    const best = bestRow(weeks, latest, lift);
    const lines: string[] = [];
    if (best === undefined || best.e1rmKg === null) {
      lines.push(`Intet e1RM i ${blockLabel(latest)} endnu`);
    } else {
      const set = setText(best);
      const week = `uge ${blockWeekOf(weeks, latest, best.weekStart)}`;
      lines.push(set === "" ? week : `${set} · ${week}`);
      lines.push(best.e1rmRpeSource === "logged" ? "logget RPE" : "baseret på foreskrevet RPE");
    }
    if (phase !== null) {
      const earlier = [...new Set(weeks.map((w) => w.blockNo))]
        .filter((n): n is number => n !== null && n < latest && phaseOfBlock(blocks, weeks, n) === phase)
        .sort((a, b) => b - a)
        .map((n) => bestRow(weeks, n, lift))
        .find((r) => r !== undefined);
      if (earlier !== undefined && earlier.e1rmKg !== null && earlier.blockNo !== null) {
        anyEarlier = true;
        lines.push(`Blok ${earlier.blockNo}: ${formatE1rm(earlier.e1rmKg)} kg`);
      }
    }
    return {
      lift,
      name: LIFT_NAME[lift],
      value: best === undefined || best.e1rmKg === null ? MISSING : `${formatE1rm(best.e1rmKg)} kg`,
      logged: best !== undefined && best.e1rmKg !== null && best.e1rmRpeSource === "logged",
      lines,
    };
  });
  const phaseText = phase === null ? null : PHASE_TEXT[phase];
  const firstNote =
    anyEarlier || phaseText === null
      ? null
      : `Blok ${latest} er den første blok ${phaseText}, så der er ingen blok at sammenligne med endnu.`;
  return { label: `Bedste e1RM · ${blockLabel(latest)}`, phase: phaseText, rows, firstNote, sr: boardSr(rows, latest, phaseText) };
}

function boardSr(rows: readonly BoardRow[], latest: number, phase: string | null): string {
  const values = rows
    .map((r) => `${liftLower(r.lift)} ${r.value === MISSING ? "ikke registreret" : r.value.replace(" kg", " kilo")}`)
    .join(", ");
  const head = `Bedste estimerede 1RM i ${blockLabel(latest)}${phase === null ? "" : `, ${phase}`}: ${values}.`;
  const valued = rows.filter((r) => r.value !== MISSING);
  const logged = valued.filter((r) => r.logged);
  const names = (rs: readonly BoardRow[]) => listWords(rs.map((r) => liftLower(r.lift)));
  if (valued.length === 0) return head;
  if (logged.length === 0)
    return `${head} ${valued.length === 3 ? "Alle tre er" : `${capital(names(valued))} er`} baseret på foreskrevet RPE.`;
  if (logged.length === valued.length)
    return `${head} ${valued.length === 3 ? "Alle tre er" : `${capital(names(valued))} er`} baseret på logget RPE.`;
  return `${head} ${capital(names(logged))} er baseret på logget RPE, de andre på foreskrevet.`;
}

// --- axis, blocks, phases (spec §5) --------------------------------------------------------

const MONTH = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" });

/** Month starts inside [lo, hi]; the year on January and on a first tick outside the current year. */
export function monthTicks(lo: number, hi: number, today: IsoDate): AxisTick[] {
  const out: AxisTick[] = [];
  const first = new Date((lo + 0.5) * 86_400_000);
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); ; m += 1) {
    if (m === 12) {
      m = 0;
      y += 1;
    }
    const date = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const x = dayNumber(date);
    if (x > hi) break;
    if (x < lo) continue;
    const month = MONTH.format(new Date(`${date}T00:00:00Z`));
    const withYear = m === 0 || (out.length === 0 && y !== yearOf(today));
    out.push({ x, label: withYear ? `${month} ${y}` : month });
  }
  return out;
}

export function blockSpans(blocks: readonly StrengthBlockRow[], lo: number, hi: number): BlockSpan[] {
  return blocks
    .map((b) => {
      const x0 = Math.max(dayNumber(b.startDate) - 0.5, lo);
      // end_date is the Sunday of the last week (inclusive, as /load); an ongoing block runs to the current week.
      const x1 = b.endDate === null ? hi : Math.min(dayNumber(b.endDate) + 0.5, hi);
      const deloadX0 = b.deloadStart === null ? null : Math.max(dayNumber(b.deloadStart) - 0.5, x0);
      return { x0, x1, blockNo: b.blockNo, label: `Blok ${b.blockNo}`, deloadX0: deloadX0 !== null && deloadX0 < x1 ? deloadX0 : null };
    })
    .filter((s) => s.x1 > s.x0);
}

/** x of every block start whose phase differs from the previous block's (both known). */
export function phaseChanges(blocks: readonly StrengthBlockRow[]): { readonly block: StrengthBlockRow; readonly from: StrengthPhase }[] {
  const out: { block: StrengthBlockRow; from: StrengthPhase }[] = [];
  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1].phase;
    const cur = blocks[i].phase;
    if (prev !== null && cur !== null && prev !== cur) out.push({ block: blocks[i], from: prev });
  }
  return out;
}

/** "Blok 11 er i sæson, blok 12–13 uden for sæson." from runs of consecutive blocks in one phase. */
export function phaseSentence(blocks: readonly StrengthBlockRow[]): string | null {
  const runs: { phase: StrengthPhase; nos: number[] }[] = [];
  for (const b of blocks) {
    if (b.phase === null) continue;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.phase === b.phase) last.nos.push(b.blockNo);
    else runs.push({ phase: b.phase, nos: [b.blockNo] });
  }
  if (runs.length === 0) return null;
  const parts = runs.map((r, i) => (i === 0 ? `Blok ${blockNumbers(r.nos)} er ${PHASE_TEXT[r.phase]}` : `blok ${blockNumbers(r.nos)} ${PHASE_TEXT[r.phase]}`));
  return `${parts.join(", ")}.`;
}

// --- e1RM panels (spec §5a, §7) ------------------------------------------------------------

/** Rounded out to 5 kg, 2-3 ticks. */
export function kgDomain(values: readonly number[]): { domain: [number, number]; ticks: number[] } {
  let min = Math.floor(Math.min(...values) / 5) * 5;
  let max = Math.ceil(Math.max(...values) / 5) * 5;
  if (max === min) {
    min -= 5;
    max += 5;
  }
  const step = [5, 10, 20, 25, 50, 100, 200].find((s) => Math.ceil(max / s) - Math.floor(min / s) <= 2) ?? 200;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { domain: [min, max], ticks };
}

function panel(
  lift: StrengthLift,
  weeks: readonly StrengthWeekRow[],
  blocks: readonly StrengthBlockRow[],
  spans: readonly BlockSpan[],
  sheetRows: StrengthAnalysisData["sheetOneRm"],
  warnings: string[],
): E1rmPanel {
  const rows = weeks.filter((w): w is E1rmRow => w.lift === lift && hasE1rm(w));
  const sheet: SheetLine[] = [];
  const sheetSr: string[] = [];
  const sheetByBlock = new Map<number, number>();
  blocks.forEach((b) => {
    const span = spans.find((s) => s.blockNo === b.blockNo);
    if (span === undefined) return;
    const { kg, warning } = sheetOneRm(sheetRows, b.name, lift);
    if (warning !== null) warnings.push(warning);
    if (kg === null) return;
    sheetByBlock.set(b.blockNo, kg);
    sheet.push({ x0: span.x0, x1: span.x1, y: kg, label: formatKg(kg) });
    sheetSr.push(`${formatKg(kg)} kilo i ${blockLabel(b.blockNo)}`);
  });
  const points: E1rmPoint[] = rows.map((r) => {
    const sheetKg = r.blockNo === null ? undefined : sheetByBlock.get(r.blockNo);
    return {
      x: dayNumber(r.weekStart) + 3,
      y: r.e1rmKg,
      logged: r.e1rmRpeSource === "logged",
      best: r.isBlockBest,
      label: r.isBlockBest ? formatE1rm(r.e1rmKg) : null,
      // Under the ring when the point sits below its block's sheet line (a comparison, no maths).
      labelBelow: sheetKg !== undefined && r.e1rmKg < sheetKg,
    };
  });
  // One line per block: it breaks at every block boundary (and never joins points outside a block).
  const segments: E1rmPoint[][] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (i === 0 || r.blockNo === null || prev.blockNo !== r.blockNo) segments.push([points[i]]);
    else segments[segments.length - 1].push(points[i]);
  });
  const name = LIFT_NAME[lift];
  if (rows.length === 0) {
    return { lift, name, empty: `Intet e1RM endnu for ${liftLower(lift)}.`, points, segments: [], sheet, domain: [0, 1], ticks: [], sr: `${name}: intet e1RM endnu.` };
  }
  const { domain, ticks } = kgDomain([...points.map((p) => p.y), ...sheet.map((s) => s.y)]);
  const first = rows[0].weekStart;
  const last = rows[rows.length - 1].weekStart;
  const span = rows.length === 1 ? `1 uge med e1RM den ${dated(first)}` : `${rows.length} uger med e1RM fra ${formatDate(first)} til ${dated(last)}`;
  const bests = rows
    .filter((r): r is E1rmRow & BlockRow => r.isBlockBest && inBlock(r))
    .map((r) => {
      const ph = r.phase ?? phaseOfBlock(blocks, weeks, r.blockNo);
      return `Bedst i ${blockLabel(r.blockNo)}${ph === null ? "" : ` (${PHASE_TEXT[ph]})`}: ${formatE1rm(r.e1rmKg)} kilo.`;
    });
  const distinctSheet = [...new Set(sheet.map((s) => s.label))];
  const sheetText =
    sheet.length === 0
      ? null
      : distinctSheet.length === 1
        ? `1RM i arket, ikke testet: ${distinctSheet[0]} kilo.`
        : `1RM i arket, ikke testet: ${sheetSr.join(", ")}.`;
  const sr = [`${name}: ${span}`, ...bests, ...(sheetText === null ? [] : [sheetText])].join(" ");
  return { lift, name, empty: null, points, segments: segments.filter((s) => s.length >= 2), sheet, domain, ticks, sr };
}

// --- weeks (spec §5b, §5c, §7) -------------------------------------------------------------

export function strengthWeeks(
  weeks: readonly StrengthWeekRow[],
  blocks: readonly StrengthBlockRow[],
  today: IsoDate,
  lo: number,
): StrengthWeek[] {
  const year = yearOf(today);
  const current = isoWeekStart(today);
  const starts = [...new Set(weeks.map((w) => w.weekStart))].sort();
  return starts.map((ws) => {
    const rows = weeks.filter((w) => w.weekStart === ws);
    const byLift = (l: StrengthLift) => rows.find((r) => r.lift === l);
    const end = addDays(ws, 6);
    const range = formatDateRange(ws, end);
    const blockNo = rows.find((r) => r.blockNo !== null)?.blockNo ?? null;
    const block = blockNo === null ? undefined : blocks.find((b) => b.blockNo === blockNo);
    const isCurrent = ws === current;
    const where = blockNo === null ? "mellem blokke" : `${blockLabel(blockNo)}, uge ${blockWeekOf(weeks, blockNo, ws)}`;
    const head = [
      `Uge ${isoWeekNumber(ws)} · ${yearOf(end) === year ? range : `${range} ${yearOf(end)}`} · ${where}`,
      ...(block !== undefined && block.deloadStart !== null && block.deloadStart <= ws ? ["deload"] : []),
      ...(rows.some((r) => r.status === "pre_log") ? ["før aktivitetslog"] : []),
      ...(isCurrent ? ["indtil videre"] : []),
    ].join(" · ");
    const e1rmTip = LIFTS.map((l) => {
      const r = byLift(l);
      const name = LIFT_NAME[l];
      if (r === undefined) return `${name}: mangler`;
      if (r.status === null) return `${name}: ikke trænet`;
      if (r.e1rmKg === null) return `${name}: intet tungt sæt med RPE`;
      const set = setText(r);
      const source = r.e1rmRpe === null ? "" : r.e1rmRpeSource === "logged" ? " logget" : " foreskrevet";
      return `${name}: ${formatE1rm(r.e1rmKg)} kg${set === "" ? "" : ` · ${set}${source}`}${r.isBlockBest ? " · bedst i blokken" : ""}`;
    });
    const tonnageTip = LIFTS.map((l) => {
      const r = byLift(l);
      const name = LIFT_NAME[l];
      if (r === undefined) return `${name}: mangler`;
      return r.status === null ? `${name}: ikke trænet` : `${name}: ${formatTonnage(r.tonnageKg)} kg · ${r.setsLifted} sæt`;
    });
    // A missing row is null ("mangler"), never 0: 0 is a real week with nothing lifted.
    const tonnage = perLift((l) => byLift(l)?.tonnageKg ?? null);
    const tonnageText = (v: number | null) => (v === null ? "mangler" : formatTonnage(v));
    return {
      x0: Math.max(dayNumber(ws) - 0.5, lo),
      x1: dayNumber(ws) + 6.5,
      current: isCurrent,
      head,
      e1rmTip,
      tonnageTip,
      tonnage,
      srRow: [
        `Uge ${isoWeekNumber(ws)} · ${range}`,
        where,
        tonnageText(tonnage.SQUAT),
        tonnageText(tonnage.BENCH),
        tonnageText(tonnage.DEADLIFT),
      ],
    };
  });
}

// --- page ----------------------------------------------------------------------------------

const latestComputedAt = (weeks: readonly StrengthWeekRow[]): string | null =>
  weeks.reduce<string | null>((a, r) => (a === null || Date.parse(r.computedAt) > Date.parse(a) ? r.computedAt : a), null);

export function buildStyrkeView(data: StrengthAnalysisData, now: Date, today: IsoDate): StyrkeView {
  const { weeks, blocks } = data;
  const latest = latestBlockNo(weeks);
  if (weeks.length === 0 || latest === null) return { kind: "empty" };
  const firstStart = [...weeks.map((w) => w.weekStart)].sort()[0];
  const lo = dayNumber(firstStart) - 0.5;
  const hi = dayNumber(addDays(isoWeekStart(today), 6)) + 0.5;
  const ticksWide = monthTicks(lo, hi, today);
  const ticksNarrow = ticksWide.length > 6 ? ticksWide.filter((_, i) => i % 2 === 0) : ticksWide;
  const spans = blockSpans(blocks, lo, hi);
  // Only blocks that have started: a tab the coach published ahead must not draw past the plot.
  const started = blocks.filter((b) => b.startDate <= today);
  const changes = phaseChanges(started).filter((c) => {
    const x = dayNumber(c.block.startDate) - 0.5;
    return x > lo && x < hi;
  });
  const warnings: string[] = [];
  const allPanels = LIFTS.map((l) => panel(l, weeks, blocks, spans, data.sheetOneRm, warnings));
  const panels = allPanels.every((p) => p.empty !== null) ? null : allPanels;
  const anyPrescribed = weeks.some((w) => w.e1rmKg !== null && w.e1rmRpeSource !== "logged");
  const anyLogged = weeks.some((w) => w.e1rmRpeSource === "logged");
  const phases = phaseSentence(started);
  const preLog = [...new Set(weeks.filter((w): w is BlockRow => w.status === "pre_log" && inBlock(w)).map((w) => w.blockNo))];
  const notes = [
    ...(panels !== null && anyPrescribed ? [NOTE_PRESCRIBED] : []),
    ...(phases === null
      ? []
      : [changes.length > 0 ? `${phases} Den lodrette streg er faseskiftet: sammenlign blokke i samme fase.` : phases]),
    ...(preLog.length === 0
      ? []
      : [
          `Blok ${blockNumbers(preLog)} er fra før aktivitetsloggen. ${preLog.length === 1 ? "Dens" : "Deres"} uger tæller med, når ugen er slut, ikke når en session registreres.`,
        ]),
    NOTE_ESTIMATE,
  ];
  const strengthRows = strengthWeeks(weeks, blocks, today, lo);
  return {
    kind: "ready",
    freshness: freshness(latestComputedAt(weeks), now),
    lo,
    hi,
    ticksNarrow,
    ticksWide,
    blocks: spans,
    phaseRules: changes.map((c) => dayNumber(c.block.startDate) - 0.5),
    board: buildBoard(weeks, blocks, latest),
    panels,
    hasSheet: allPanels.some((p) => p.sheet.length > 0),
    hasDeload: spans.some((s) => s.deloadX0 !== null),
    notes,
    phaseSr:
      changes.length === 0
        ? null
        : changes
            .map((c) => `Faseskift fra ${PHASE_TEXT[c.from]} til ${PHASE_TEXT[c.block.phase ?? c.from]} den ${dated(c.block.startDate)}`)
            .join(" "),
    weeks: strengthRows,
    tonnageMax: perLift((l) =>
      Math.max(0, ...strengthRows.flatMap((w) => {
        const v = w.tonnage[l];
        return v === null ? [] : [v];
      })),
    ),
    rpeLine: anyLogged ? null : RPE_LINE,
    warnings,
  };
}
