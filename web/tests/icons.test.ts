import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

// icons.tsx is JSX, which Node's type stripping can't load, so these read the source.
const SRC = join(import.meta.dirname, "..", "src");
const ICONS = join(SRC, "components", "icons.tsx");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

test("I1/I2: lucide-react is imported only in components/icons.tsx", () => {
  const importers = files(SRC)
    .filter((f) => /from\s+["']lucide-react|import\(\s*["']lucide-react|require\(\s*["']lucide-react/.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f).split(sep).join("/"));
  assert.deepEqual(importers, ["components/icons.tsx"]);
});

function block(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  return source.slice(from, source.indexOf("};", from));
}

test("every IconName maps to exactly one icon (Lucide or one of the three own tab paths)", () => {
  const source = readFileSync(ICONS, "utf8");
  const unionStart = source.indexOf("export type IconName =");
  const union = source.slice(unionStart, source.indexOf(";", unionStart));
  const names = [...union.matchAll(/\|\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 17, `parsed ${names.length} names`);

  const keys = (text: string) => [...text.matchAll(/^\s+"?([a-z-]+)"?:/gm)].map((m) => m[1]);
  const own = keys(block(source, "const OWN:"));
  const lucide = keys(block(source, "const LUCIDE:"));
  assert.deepEqual(own.sort(), ["barbell", "bars", "trend"]);
  const mapped = [...own, ...lucide];
  assert.deepEqual([...mapped].sort(), [...names].sort(), "each name once, nothing extra");

  // Each Lucide value is an imported lucide-react export.
  const imported = new Set(block(source, "import {").match(/\b[A-Z]\w+\b/g));
  for (const m of block(source, "const LUCIDE:").matchAll(/:\s*([A-Z]\w+),/g)) assert.ok(imported.has(m[1]), m[1]);
});

test("the tab icons keep their animatable parts (motion-icons)", () => {
  const source = readFileSync(ICONS, "utf8");
  assert.match(source, /<g className="i-dumb">\s*<path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" \/>/);
  assert.match(source, /className="i-line" pathLength=\{1\} d="M3 17l5-6 4 3 4-7 5 5"/);
  for (const d of ["M5 20V11", "M11 20V5", "M17 20v-7"]) assert.ok(source.includes(`<path className="i-b" d="${d}" />`), d);
  assert.ok(source.includes(`<path d="M2.5 20.5h19" />`));
});
