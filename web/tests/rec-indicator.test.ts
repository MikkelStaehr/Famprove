// Slice rec-indicator (DESIGN.md Part B "Recording colour rule", video-record.md §5/§11): --rec is
// the recording dot and nothing else, and the Fokus strip height is one token, never hand-typed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}
const ALL = files(SRC).map((p) => ({ p: p.slice(SRC.length + 1), s: readFileSync(p, "utf8") }));

test("--rec is used only by the recording dot", () => {
  // Tailwind utilities on the colour (bg-rec, text-rec, border-rec, fill-rec, …) and var(--rec).
  const uses = ALL.flatMap(({ p, s }) =>
    [...s.matchAll(/(?<![\w-])(?:[a-z]+-rec(?![\w-])|var\(--rec\))/g)].map((m) => `${p}: ${m[0]}`),
  );
  assert.deepEqual(uses.sort(), ["app/globals.css: var(--rec)", "components/fokus/RecordParts.tsx: bg-rec"]);
  const css = ALL.find((f) => f.p === "app/globals.css")?.s ?? "";
  assert.match(css, /--color-rec: var\(--rec\);/, "the one var(--rec) is its @theme colour");
  const parts = ALL.find((f) => f.p === "components/fokus/RecordParts.tsx")?.s ?? "";
  assert.match(parts, /aria-hidden="true" className="rec-pulse inline-block size-5 shrink-0 rounded-full bg-rec"/, "a 20px aria-hidden pulsing disc");
});

test("the rest card and the recording strip share --h-fokus-strip; nothing hand-typed", () => {
  const typed = ALL.filter(({ p, s }) => s.includes("11.1125") && p !== "app/globals.css").map(({ p }) => p);
  assert.deepEqual(typed, []);
  const css = ALL.find((f) => f.p === "app/globals.css")?.s ?? "";
  assert.equal([...css.matchAll(/11\.1125/g)].length, 1, "defined once, as --h-fokus-strip");
  for (const [file, label] of [["components/fokus/PauseParts.tsx", "Pause"], ["components/fokus/RecordParts.tsx", "Optagelse"]] as const) {
    const s = ALL.find((f) => f.p === file)?.s ?? "";
    assert.match(s, new RegExp(`aria-label="${label}" className="[^"]*\\bmin-h-\\(--h-fokus-strip\\)`), `${label} uses the token`);
  }
});
