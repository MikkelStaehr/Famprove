// Design acceptance checks on the pure parts: tokens vs DESIGN.md Part B (Ember, 2026-10-14),
// contrast from token values, zone-bar fixtures, zone from form_zone, and Danish formats.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hero } from "../src/lib/dashboard-view.ts";
import type { DailyLoadRow } from "../src/lib/db/rows.ts";
import { formatDay, formatDayLong, formatKg, formatSigned, formatUpdatedAt } from "../src/lib/format.ts";
import { trainingHeader } from "../src/lib/training-view.ts";
import { pinned, position, THRESHOLDS, zoneSentence } from "../src/lib/zone-scale.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const CSS = read("../src/app/globals.css");
const DESIGN = read("../../DESIGN.md");

// --- tokens -------------------------------------------------------------------------------

/** DESIGN.md Part B colour table (Ember): | `--token` | #hex | role | */
const TABLE = DESIGN.slice(DESIGN.indexOf("## Colour tokens (`:root`"), DESIGN.indexOf("\n## Type", DESIGN.indexOf("## Colour tokens (`:root`")));
const expected = [...TABLE.matchAll(/^\| `(--[a-z0-9-]+)` \| (#[0-9A-Fa-f]{6}) \|/gm)].map(([, name, hex]) => ({
  name: name ?? "",
  hex: (hex ?? "").toLowerCase(),
}));
/** Part B "Shape": | `--radius-x` | px | use | */
const SHAPE = DESIGN.slice(DESIGN.indexOf("## Shape"), DESIGN.indexOf("## Space and density"));
const radii = [...SHAPE.matchAll(/^\| `(--radius-[a-z]+)` \| (\d+) \|/gm)].map(([, name, px]) => ({ name: name ?? "", px: `${px ?? ""}px` }));
/** Part B "Type": | `text-NN` (line-height) | ... */
const TYPE = DESIGN.slice(DESIGN.indexOf("## Type", DESIGN.indexOf("# Part B")), DESIGN.indexOf("## Shape"));
const sizes = [...TYPE.matchAll(/^\| `text-(\d+)` \(([\d.]+)\)/gm)].map(([, px, lh]) => ({ px: Number(px), lh: lh ?? "" }));

function block(css: string, start: number): string {
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced css");
}
function vars(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => [k ?? "", (v ?? "").trim()]));
}
const ROOT = vars(block(CSS, CSS.indexOf(":root")));
const THEME_INLINE = vars(block(CSS, CSS.indexOf("@theme inline")));
const THEME_STATIC = vars(block(CSS, CSS.indexOf("@theme static")));

test("DESIGN.md Part B lists the Ember tokens this test checks", () => {
  assert.equal(expected.length, 21, `parsed ${expected.length} hex colour tokens`);
  assert.equal(radii.length, 8, `parsed ${radii.length} radius tokens`);
  assert.deepEqual(
    sizes.map((s) => s.px),
    [56, 48, 28, 24, 22, 20, 16, 15, 14, 13, 12, 11],
  );
});

test("every Part B colour token has its DESIGN.md value at :root, dark only", () => {
  for (const { name, hex } of expected) assert.equal(ROOT.get(name)?.toLowerCase(), hex, name);
  assert.equal(ROOT.get("color-scheme"), undefined); // a property, not a variable
  assert.match(block(CSS, CSS.indexOf(":root")), /color-scheme: dark;/);
  assert.ok(!CSS.includes("prefers-color-scheme"), "one theme only: no light palette");
});

test("retired Instrument and Spurt tokens never come back", () => {
  for (const retired of ["--surface", "--caption:", "--accent", "--positive", "--negative", "--series-", "--chart-mark", "--chart-today", "--grain", "--slab", "--on-slab", "--block-fill", "--prognose-band", "--card-shadow", "--shadow-card", "--radius-mark", "--font-display", "--font-inter", "--font-instrument-mono", "--font-grotesk"]) {
    assert.ok(!CSS.includes(retired), `${retired} is retired`);
  }
  assert.ok(!CSS.includes("data-direction"));
  assert.ok(!/body::after/.test(CSS), "no registration marks");
  assert.ok(!/box-shadow/.test(CSS), "no shadows anywhere");
  const LAYOUT = read("../src/app/layout.tsx");
  assert.match(LAYOUT, /import \{ Geist, Geist_Mono \} from "next\/font\/google";/);
  assert.ok(!/Inter|Chivo/.test(LAYOUT));
  assert.match(LAYOUT, /colorScheme: "dark"/);
});

test("every Part B colour token is exposed through @theme inline as --color-*, and nothing else", () => {
  const missing = expected.map(({ name }) => name).filter((name) => THEME_INLINE.get(`--color-${name.slice(2)}`) !== `var(${name})`);
  assert.deepEqual(missing, []);
  const colours = [...THEME_INLINE.keys()].filter((k) => k.startsWith("--color-"));
  assert.deepEqual(
    colours.filter((k) => !["--color-transparent", "--color-current"].includes(k)).sort(),
    expected.map(({ name }) => `--color-${name.slice(2)}`).sort(),
  );
});

test("type, radius and font tokens follow Part B; Tailwind defaults stay removed", () => {
  for (const { px, lh } of sizes) {
    assert.equal(THEME_INLINE.get(`--text-${px}`), `${px / 16}rem`, `text-${px}`);
    assert.equal(THEME_INLINE.get(`--text-${px}--line-height`), lh, `text-${px} line height`);
  }
  assert.ok(![...THEME_INLINE.keys()].some((k) => /^--text-\d+$/.test(k) && !sizes.some((s) => `--text-${s.px}` === k)), "no size outside Part B");
  for (const { name, px } of radii) assert.equal(THEME_STATIC.get(name), px, name);
  assert.equal(THEME_STATIC.get("--radius-pill"), "999px");
  assert.equal(THEME_INLINE.get("--font-sans"), "var(--font-geist), system-ui, sans-serif");
  assert.equal(THEME_INLINE.get("--font-mono"), "var(--font-geist-mono), ui-monospace, monospace");
  assert.match(CSS, /--color-\*: initial;/);
  assert.match(CSS, /--text-\*: initial;/);
  assert.match(CSS, /--radius-\*: initial;/);
});

// --- contrast (WCAG 2.x relative luminance) ------------------------------------------------

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** [foreground, background] pairs that carry text (4.5:1) or marks/focus/control outlines (3:1). */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ["--text", "--bg"],
  ["--text", "--card"],
  ["--text-muted", "--bg"],
  ["--text-muted", "--card"],
  ["--today", "--bg"],
  ["--today", "--card"],
  ["--warning", "--card"],
  ["--zone-risk", "--card"],
  ["--zone-optimal", "--card"],
  ["--zone-neutral", "--card"],
  ["--zone-fresh", "--card"],
  ["--zone-transition", "--card"],
  ["--inverse-text", "--inverse-bg"],
  ["--inverse-muted", "--inverse-bg"],
  ["--inverse-text", "--text"], // the primary button's label on its --text fill
];
const MARK_PAIRS: readonly (readonly [string, string])[] = [
  ["--focus", "--bg"],
  ["--focus", "--card"],
  ["--shade-2", "--card"],
  ["--text-muted", "--card"], // secondary button border
];

test("text ≥ 4.5:1 and marks/focus ≥ 3:1, computed from the token values", () => {
  const hex = (name: string) => {
    const v = (ROOT.get(name) ?? "").toLowerCase();
    assert.ok(/^#[0-9a-f]{6}$/.test(v), `${name} is a hex token`);
    return v;
  };
  const fails: string[] = [];
  for (const [fg, bg] of TEXT_PAIRS) {
    const r = ratio(hex(fg), hex(bg));
    if (r < 4.5) fails.push(`text ${fg} on ${bg} = ${r.toFixed(2)}`);
  }
  for (const [fg, bg] of MARK_PAIRS) {
    const r = ratio(hex(fg), hex(bg));
    if (r < 3) fails.push(`mark ${fg} on ${bg} = ${r.toFixed(2)}`);
  }
  assert.deepEqual(fails, []);
  // Part B: --today on the inverse card is 2.91:1, so it is forbidden there.
  assert.ok(ratio(hex("--today"), hex("--inverse-bg")) < 3);
});

test("orange is only today: no text, status or zone token resolves to --today", () => {
  const today = ROOT.get("--today");
  for (const t of ["--text", "--text-muted", "--focus", "--warning", "--zone-risk", "--zone-optimal", "--zone-neutral", "--zone-fresh", "--zone-transition"]) {
    assert.notEqual(ROOT.get(t), today, t);
  }
});

// --- zone bar -------------------------------------------------------------------------------

const FIXTURES = [
  { tsb: -12, zone: "optimal", flag: "−12", x: 28 / 70, pin: null },
  { tsb: 4, zone: "grey_zone", flag: "+4", x: 44 / 70, pin: null },
  { tsb: -45, zone: "high_risk", flag: "−45", x: 0, pin: "low" },
  { tsb: 34, zone: "transition", flag: "+34", x: 1, pin: "high" },
] as const;

test("zone-bar fixtures: signed flag value with U+2212, marker at (clamp+40)/70, off-scale pins", () => {
  for (const f of FIXTURES) {
    assert.equal(formatSigned(f.tsb), f.flag, `flag ${f.tsb}`);
    assert.ok(!formatSigned(f.tsb).includes("-"), "never a hyphen-minus");
    assert.ok(Math.abs(position(f.tsb) - f.x) < 1e-9, `x ${f.tsb}`);
    assert.equal(pinned(f.tsb), f.pin, `pin ${f.tsb}`);
  }
  assert.deepEqual(THRESHOLDS.map((t) => formatSigned(t).replace("+", "")), ["−30", "−10", "5", "20"]);
});

test("zone-bar sr sentence per fixture (today.md §5a)", () => {
  assert.equal(zoneSentence(-12, "optimal"), "Form minus 12 TSS per dag: optimal, som går fra minus 30 til minus 10.");
  assert.equal(zoneSentence(4, "grey_zone"), "Form plus 4 TSS per dag: neutral, som går fra minus 10 til 5.");
  assert.equal(
    zoneSentence(-45, "high_risk"),
    "Form minus 45 TSS per dag: risiko, minus 30 og lavere. Uden for skalaen, som går fra minus 40 til 30.",
  );
  assert.equal(
    zoneSentence(34, "transition"),
    "Form plus 34 TSS per dag: pause, 20 og højere. Uden for skalaen, som går fra minus 40 til 30.",
  );
  assert.equal(zoneSentence(11, "fresh"), "Form plus 11 TSS per dag: frisk, som går fra 5 til 20.");
  assert.equal(zoneSentence(24, "transition"), "Form plus 24 TSS per dag: pause, 20 og højere.");
  assert.equal(
    zoneSentence(4, "grey_zone", formatDayLong("2026-09-27")),
    "Form plus 4 TSS per dag: neutral, som går fra minus 10 til 5. Tallet er fra søndag 27. september.",
  );
});

const row = (tsb: number, formZone: string | null): DailyLoadRow => ({
  date: "2026-09-30",
  cyclingTss: 0,
  strengthTss: 0,
  totalTss: 0,
  ctl: 45,
  atl: 41,
  tsb,
  ctlRamp7d: null,
  formZone,
  computedAt: "2026-09-30T03:03:00Z",
});

test("TSB +4 stored as form_zone 'fresh' shows FRISK on Træning and /load (zone never derived from TSB)", () => {
  const header = trainingHeader(row(4, "fresh"), new Date("2026-09-30T08:00:00Z"));
  assert.equal(header?.zone?.key, "fresh");
  assert.equal(header?.zone?.label, "Frisk");
  assert.equal(hero(row(4, "fresh")).zone?.label, "Frisk");
  assert.equal(zoneSentence(4, header?.zone?.key ?? null), "Form plus 4 TSS per dag: frisk, som går fra 5 til 20.");
  assert.equal(trainingHeader(row(4, null), new Date("2026-09-30T08:00:00Z"))?.zone, null);
});

// --- Danish formats ------------------------------------------------------------------------

test("Danish dates, times and decimal comma", () => {
  assert.equal(formatDay("2026-09-30"), "ons. 30. sep.");
  assert.equal(formatDay("2026-09-29"), "tirs. 29. sep.");
  assert.equal(formatDay("2026-09-27"), "søn. 27. sep.");
  assert.equal(formatUpdatedAt("2026-09-30T07:31:00Z"), "30. sep. kl. 09.31");
  assert.equal(formatUpdatedAt("2026-09-28T03:03:00Z"), "28. sep. kl. 05.03");
  assert.match(formatKg(62.5), /^62,5/);
});
