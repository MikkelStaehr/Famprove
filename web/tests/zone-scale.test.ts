import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BANDS, pinned, position, THRESHOLDS } from "../src/lib/zone-scale.ts";

const FORM_PY = readFileSync(
  new URL("../../python/src/training_load/domain/form.py", import.meta.url),
  "utf8",
);

test("zone-bar bands match python/src/training_load/domain/form.py", () => {
  // FormZone enum: TRANSITION = "transition", ...
  const keys = new Map(
    [...FORM_PY.matchAll(/^\s{4}([A-Z_]+) = "([a-z_]+)"$/gm)].map(([, name, value]) => [name, value]),
  );
  // FORM_ZONES: ZoneBand(FormZone.FRESH, 5.0, ...), ..., ZoneBand(FormZone.HIGH_RISK, None)
  const bands = [...FORM_PY.matchAll(/ZoneBand\(FormZone\.([A-Z_]+), (-?\d+(?:\.\d+)?|None)/g)].map(
    ([, name, lower]) => ({
      key: keys.get(name ?? ""),
      lower: lower === "None" ? null : Number(lower),
    }),
  );
  assert.equal(bands.length, 5, "expected exactly 5 ZoneBand rows in form.py");
  assert.match(FORM_PY, /^FORM_BASIS: Final\[FormBasis\] = FormBasis\.ABSOLUTE_TSB$/m);
  assert.deepEqual(
    bands.toReversed(),
    BANDS.map((b) => ({ key: b.key, lower: b.lower })),
  );
});

test("the scale is linear from −40 to +30 and the bands tile it", () => {
  assert.equal(position(-40), 0);
  assert.equal(position(30), 1);
  assert.ok(Math.abs(position(4) - 44 / 70) < 1e-9);
  assert.deepEqual(THRESHOLDS, [-30, -10, 5, 20]);
  assert.equal(BANDS[0]?.start, 0);
  assert.equal(BANDS.at(-1)?.end, 1);
  for (const [i, band] of BANDS.entries()) {
    if (i > 0) assert.equal(band.start, BANDS[i - 1]?.end);
  }
  assert.ok(Math.abs((BANDS[1]?.start ?? 0) - 10 / 70) < 1e-9); // −30 at 14.29%
});

test("off-scale values pin the marker to the end but keep their own number", () => {
  assert.equal(position(-45), 0);
  assert.equal(position(34), 1);
  assert.equal(pinned(-45), "low");
  assert.equal(pinned(34), "high");
  assert.equal(pinned(-40), null);
  assert.equal(pinned(-35), null);
});
