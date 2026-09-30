import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BANDS, pinned, position, THRESHOLDS, zoneReading, zoneSentence } from "../src/lib/zone-scale.ts";

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

test("zoneSentence reads the zone from form_zone and writes the sign out", () => {
  assert.equal(zoneSentence(4, "grey_zone"), "Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5.");
  assert.equal(zoneSentence(-34, "high_risk"), "Form minus 34 TSS per dag: høj risiko, under minus 30.");
  assert.equal(zoneSentence(0.2, "grey_zone"), "Form 0 TSS per dag: gråzone, som går fra minus 10 til 5.");
  assert.equal(zoneSentence(4, null), "Form plus 4 TSS per dag. Zone ikke beregnet.");
  // The zone comes from Python, even when it disagrees with the drawing thresholds.
  assert.equal(zoneSentence(24, "fresh"), "Form plus 24 TSS per dag: frisk, som går fra 5 til 20.");
  assert.equal(
    zoneSentence(-46, "high_risk", "søndag 27. september"),
    "Form minus 46 TSS per dag: høj risiko, under minus 30. Uden for skalaen, som går fra minus 40 til 30. Tallet er fra søndag 27. september.",
  );
});

test("zoneReading gives load.md §8a's sentence per form_zone, from the key only", () => {
  const cases: readonly (readonly [string | null, string])[] = [
    ["high_risk", "Du er langt mere træt, end din fitness kan bære. Tag lette dage, før du belaster igen."],
    ["optimal", "Du er træt på den gode måde: belastningen bygger fitness op."],
    ["grey_zone", "Du er hverken træt nok til at bygge fitness eller frisk nok til at præstere."],
    ["fresh", "Du er frisk og klar til at præstere, men fitness bygges ikke op lige nu."],
    ["transition", "Du er så frisk, at fitness falder. Fint i en pause, ellers er det tid til at træne."],
    [null, "Uden zone kan dagens form ikke tolkes. Brug tallet på skalaen ovenfor."],
  ];
  for (const [zone, sentence] of cases) assert.equal(zoneReading(zone), sentence, String(zone));
  // An unknown key is not a zone: the same "can't interpret" sentence, never a guess.
  assert.equal(zoneReading("peaking"), zoneReading(null));
});
