// Spurt acceptance checks on the pure parts: tokens vs DESIGN.md Part B, contrast from token values,
// zone-bar fixtures, zone from form_zone, and Danish formats.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hero } from "../src/lib/dashboard-view.ts";
import type { DailyLoadRow } from "../src/lib/db/rows.ts";
import { formatDay, formatDayLong, formatKg, formatSigned, formatUpdatedAt } from "../src/lib/format.ts";
import { todayHeader } from "../src/lib/today-view.ts";
import { pinned, position, THRESHOLDS, zoneSentence } from "../src/lib/zone-scale.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const CSS = read("../src/app/globals.css");
const DESIGN = read("../../DESIGN.md");

// --- tokens -------------------------------------------------------------------------------

/** DESIGN.md Part B colour table: | `--token` | `#light` ... | `#dark` ... | */
const PART_B = DESIGN.slice(DESIGN.indexOf("# Part B"));
const expected = [...PART_B.matchAll(/^\| `(--[a-z-]+)` \| `(#[0-9a-f]{6})`[^|]*\| `(#[0-9a-f]{6})`/gm)].map(
  ([, name, light, dark]) => ({ name: name ?? "", light: light ?? "", dark: dark ?? "" }),
);
// The status row holds three tokens: | `--positive` / `--warning` / `--negative` | `#l1` / `#l2` / `#l3` | `#d1` / ... |
const status = PART_B.match(/^\| `--positive` \/ `--warning` \/ `--negative` \| ([^|]+)\| ([^|]+)\|/m);
const hexes = (cell: string | undefined) => [...(cell ?? "").matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);
for (const [i, name] of ["--positive", "--warning", "--negative"].entries()) {
  expected.push({ name, light: hexes(status?.[1])[i] ?? "", dark: hexes(status?.[2])[i] ?? "" });
}

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
const LIGHT = vars(block(CSS, CSS.indexOf(":root")));
const DARK = vars(block(block(CSS, CSS.indexOf("@media (prefers-color-scheme: dark)")), 0));
const THEME_INLINE = vars(block(CSS, CSS.indexOf("@theme inline")));

test("DESIGN.md Part B lists the colour tokens this test checks", () => {
  assert.equal(expected.length, 25, `parsed ${expected.length} colour tokens`);
  assert.ok(expected.every((t) => t.light !== "" && t.dark !== ""));
});

test("every Part B colour token has its DESIGN.md value in light and in dark", () => {
  for (const { name, light, dark } of expected) {
    assert.equal(LIGHT.get(name)?.toLowerCase(), light, `${name} light`);
    assert.equal(DARK.get(name)?.toLowerCase(), dark, `${name} dark`);
  }
  // Non-colour tokens: shadow is themed, chart height is the same in both themes.
  assert.match(LIGHT.get("--card-shadow") ?? "", /rgb\(/);
  assert.equal(DARK.get("--card-shadow"), "none");
  assert.equal(THEME_INLINE.get("--shadow-card"), "var(--card-shadow)");
  // DESIGN.md: 224px below 640px, 240px from 640px (load.md §9a).
  assert.equal(LIGHT.get("--chart-height"), "224px");
  const wide = vars(block(block(CSS, CSS.indexOf("@media (min-width: 640px)")), 0));
  assert.equal(wide.get("--chart-height"), "240px");
});

test("every Part B colour token is exposed through @theme inline as --color-*", () => {
  const missing = expected
    .map(({ name }) => name)
    .filter((name) => THEME_INLINE.get(`--color-${name.slice(2)}`) !== `var(${name})`);
  assert.deepEqual(missing, []);
});

test("type, radius and font tokens are exposed; Tailwind defaults and retired sizes are gone", () => {
  for (const size of [12, 14, 16, 20, 24, 32, 44, 56]) assert.ok(THEME_INLINE.has(`--text-${size}`), `text-${size}`);
  for (const r of ["mark", "control", "card", "pill"]) assert.ok(THEME_INLINE.has(`--radius-${r}`), r);
  assert.equal(THEME_INLINE.get("--text-56"), "3.5rem");
  assert.equal(THEME_INLINE.get("--text-32"), "2rem");
  assert.equal(THEME_INLINE.get("--font-sans"), "var(--font-barlow), system-ui, sans-serif");
  assert.equal(THEME_INLINE.get("--font-display"), "var(--font-barlow-condensed), system-ui, sans-serif");
  assert.ok(!THEME_INLINE.has("--text-28") && !THEME_INLINE.has("--text-40"));
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

/** [foreground, background] pairs that carry text (4.5:1) or marks/focus (3:1). */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--text", "--track"], // nav tabs on the track
  ["--bg", "--text"], // nav current tab
  ["--text-muted", "--bg"],
  ["--text-muted", "--surface"],
  ["--on-slab", "--slab"],
  ["--on-slab-muted", "--slab"],
  ["--slab", "--slab-mark"], // NÆSTE tag text on its fill
  ["--positive", "--bg"],
  ["--warning", "--bg"],
  ["--negative", "--bg"],
  ["--positive", "--surface"],
  ["--warning", "--surface"],
  ["--negative", "--surface"],
];
const MARK_PAIRS: readonly (readonly [string, string])[] = [
  ["--text-muted", "--surface"], // unticked check ring
  ["--slab-mark", "--slab"], // ✓ and the NÆSTE ring
  ["--slab", "--surface"], // ticked check, done segments
  ["--slab", "--bg"], // zone flag + marker on the page
  ["--focus", "--bg"],
  ["--focus", "--surface"],
  ["--chart-mark", "--surface"], // repeat rule, zero line
  ["--chart-mark", "--block-fill"],
  ["--series-ctl", "--block-fill"],
  ["--series-atl", "--block-fill"],
  ["--series-tsb", "--block-fill"],
  ["--series-tsb", "--surface"],
];

for (const [theme, tokens] of [
  ["light", LIGHT],
  ["dark", new Map([...LIGHT, ...DARK])],
] as const) {
  test(`${theme}: text ≥ 4.5:1 and marks/focus ≥ 3:1, computed from the token values`, () => {
    const hex = (name: string) => {
      const v = tokens.get(name);
      assert.ok(v !== undefined && /^#[0-9a-f]{6}$/i.test(v), `${name} is a hex token`);
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
  });
}

test("light: volt is only ever the slab-mark, never a text/line colour on --bg/--surface", () => {
  assert.equal(LIGHT.get("--slab-mark"), LIGHT.get("--accent"));
  assert.ok(ratio(LIGHT.get("--accent") ?? "", LIGHT.get("--bg") ?? "") < 1.3); // why it is banned there
  assert.notEqual(LIGHT.get("--slab"), LIGHT.get("--accent"));
  assert.notEqual(LIGHT.get("--focus"), LIGHT.get("--accent"));
  for (const t of ["--text", "--text-muted", "--series-ctl", "--series-atl", "--series-tsb", "--chart-mark"]) {
    assert.notEqual(LIGHT.get(t), LIGHT.get("--accent"), t);
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
  assert.equal(zoneSentence(4, "grey_zone"), "Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5.");
  assert.equal(
    zoneSentence(-45, "high_risk"),
    "Form minus 45 TSS per dag: høj risiko, minus 30 og lavere. Uden for skalaen, som går fra minus 40 til 30.",
  );
  assert.equal(
    zoneSentence(34, "transition"),
    "Form plus 34 TSS per dag: overgang, 20 og højere. Uden for skalaen, som går fra minus 40 til 30.",
  );
  assert.equal(zoneSentence(11, "fresh"), "Form plus 11 TSS per dag: frisk, som går fra 5 til 20.");
  assert.equal(zoneSentence(24, "transition"), "Form plus 24 TSS per dag: overgang, 20 og højere.");
  assert.equal(
    zoneSentence(4, "grey_zone", formatDayLong("2026-09-27")),
    "Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5. Tallet er fra søndag 27. september.",
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

test("TSB +4 stored as form_zone 'fresh' shows FRISK on Today and /load (zone never derived from TSB)", () => {
  const header = todayHeader(row(4, "fresh"), new Date("2026-09-30T08:00:00Z"));
  assert.equal(header?.zone?.key, "fresh");
  assert.equal(header?.zone?.label, "Frisk");
  assert.equal(hero(row(4, "fresh")).zone?.label, "Frisk");
  assert.equal(zoneSentence(4, header?.zone?.key ?? null), "Form plus 4 TSS per dag: frisk, som går fra 5 til 20.");
  assert.equal(todayHeader(row(4, null), new Date("2026-09-30T08:00:00Z"))?.zone, null);
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
