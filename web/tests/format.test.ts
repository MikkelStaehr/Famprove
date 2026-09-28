import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDay, formatLoad, formatSigned, formatUpdatedAt } from "../src/lib/format.ts";

test("formatLoad rounds to whole TSS and never prints -0", () => {
  assert.equal(formatLoad(72.4), "72");
  assert.equal(formatLoad(72.5), "73");
  assert.equal(formatLoad(-0.3), "0");
});

test("formatSigned uses + and a real minus sign", () => {
  assert.equal(formatSigned(5.2), "+5");
  assert.equal(formatSigned(-12.6), "−13");
  assert.equal(formatSigned(-0.3), "0");
  assert.equal(formatSigned(0), "0");
});

test("formatDay formats the calendar date without a time-zone shift", () => {
  assert.equal(formatDay("2026-03-02"), "Mon 2 Mar");
  assert.equal(formatDay("2026-01-01"), "Thu 1 Jan");
});

test("formatUpdatedAt shows Copenhagen time (CEST in summer, CET in winter)", () => {
  assert.equal(formatUpdatedAt("2026-09-28T03:05:00Z"), "28 Sept, 05:05");
  assert.equal(formatUpdatedAt("2026-01-15T23:30:00Z"), "16 Jan, 00:30");
});
