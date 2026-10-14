import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { formatOneDecimal, rampText, rampVerdict } from "../src/lib/ramp-verdict.ts";

test("1b verdict on the ramp rounded to one decimal", () => {
  const cases: readonly (readonly [number | null, string | null])[] = [
    [-0.1, "Falder"],
    [-0.04, "Sund opbygning"], // rounds to 0,0
    [0, "Sund opbygning"],
    [4.94, "Sund opbygning"],
    [4.96, "Hård opbygning"], // rounds to 5,0
    [8.0, "Hård opbygning"],
    [8.04, "Hård opbygning"], // rounds to 8,0
    [8.06, "For hurtigt"], // rounds to 8,1
    [null, null],
    [Number.NaN, null], // never "For hurtigt" for a NaN
    [Number.POSITIVE_INFINITY, null],
  ];
  for (const [ramp, label] of cases) assert.equal(rampVerdict(ramp)?.label ?? null, label, `ramp ${ramp}`);
});

test("verdict colours: neutral, optimal, transition (Pause), risk", () => {
  assert.deepEqual(
    [-1, 1, 6, 9].map((r) => rampVerdict(r)?.zone),
    ["grey_zone", "optimal", "transition", "high_risk"],
  );
});

test("1a/1e ramp text: arrow from the rounded ramp, absolute value, null as '– / 7 d'", () => {
  assert.equal(rampText(3.06).text, "↑ 3,1 / 7 d");
  assert.equal(rampText(-1.4).text, "↓ 1,4 / 7 d");
  assert.equal(rampText(-0.04).text, "→ 0,0 / 7 d");
  assert.equal(rampText(0).text, "→ 0,0 / 7 d");
  assert.equal(rampText(null).text, "– / 7 d");
  assert.equal(formatOneDecimal(18.74), "18,7");
  assert.equal(formatOneDecimal(20), "20,0");
});

test("the ramp thresholds live only in ramp-verdict.ts", () => {
  const src = new URL("../src/", import.meta.url).pathname;
  const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !f.endsWith("ramp-verdict.ts"));
  // A comparison of anything named *ramp* with 5 or 8 (e.g. `ctlRamp7d >= 5`, `ramp <= 8`).
  const pattern = /ramp\w*\)?\s*[<>]=?\s*[58](\.0)?\b|\b[58](\.0)?\s*[<>]=?\s*\(?\w*ramp/i;
  const hits = files.filter((f) => pattern.test(readFileSync(join(src, f), "utf8")));
  assert.deepEqual(hits, []);
});
