import assert from "node:assert/strict";
import { test } from "node:test";

import { capEntries, formatPerf, isServerRequest, median, mediansByKind, PERF_CAP, type PerfEntry } from "../src/lib/perf-probe.ts";

const e = (kind: PerfEntry["kind"], c: number | null, s: number | null, r: number, i = 0): PerfEntry => ({
  kind,
  from: "/train",
  to: "/load",
  at: `2026-10-31T07:00:${String(i).padStart(2, "0")}.000Z`,
  tapToContent: c,
  tapToSettled: s,
  serverRequests: r,
});

test("median: odd, even, empty", () => {
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([100, 400, 200, 300]), 250);
  assert.equal(median([]), null);
});

test("mediansByKind: per kind, nulls left out, a kind without entries is null", () => {
  const m = mediansByKind([e("tab", 100, 500, 0), e("tab", null, null, 2), e("tab", 300, 600, 1), e("minimise", 800, 800, 3)]);
  assert.deepEqual(m.tab, { n: 3, tapToContent: 200, tapToSettled: 550, serverRequests: 1 });
  assert.deepEqual(m.minimise, { n: 1, tapToContent: 800, tapToSettled: 800, serverRequests: 3 });
  assert.deepEqual(m.begin, { n: 0, tapToContent: null, tapToSettled: null, serverRequests: null });
});

test("capEntries keeps the newest 50", () => {
  let list: PerfEntry[] = [];
  for (let i = 0; i < 60; i += 1) list = capEntries(list, e("tab", i, i, 0, i % 60));
  assert.equal(list.length, PERF_CAP);
  assert.equal(list[0]!.tapToContent, 10);
  assert.equal(list[49]!.tapToContent, 59);
});

test("formatPerf: medians per kind with entries, then one line per entry", () => {
  const text = formatPerf([e("tab", 120.4, 480.6, 0), e("begin", null, null, 2, 1)]);
  assert.equal(
    text,
    [
      "famprove.perf · 2 målinger",
      "median tab (n=1): indhold 120 ms · færdig 481 ms · kald 0",
      "median begin (n=1): indhold – · færdig – · kald 2",
      "2026-10-31T07:00:00.000Z tab /train→/load 120 ms 481 ms 0 kald",
      "2026-10-31T07:00:01.000Z begin /train→/load – – 2 kald",
    ].join("\n"),
  );
});

test("isServerRequest: _rsc and app-path fetches count; assets, other origins and images don't", () => {
  const o = "https://app.example";
  assert.equal(isServerRequest(`${o}/load?_rsc=abc`, "fetch", o), true);
  assert.equal(isServerRequest(`${o}/fokus?view=set&_rsc=x1`, "other", o), true);
  assert.equal(isServerRequest(`${o}/train`, "navigation", o), true);
  assert.equal(isServerRequest(`${o}/api/refresh`, "fetch", o), true);
  assert.equal(isServerRequest(`${o}/analyse/styrke`, "fetch", o), true);
  assert.equal(isServerRequest(`${o}/_next/static/chunks/a.js`, "script", o), false);
  assert.equal(isServerRequest(`${o}/_next/static/chunks/a.js`, "fetch", o), false);
  assert.equal(isServerRequest(`${o}/favicon.ico`, "img", o), false);
  assert.equal(isServerRequest(`${o}/loader`, "fetch", o), false);
  assert.equal(isServerRequest(`https://other.example/load?_rsc=1`, "fetch", o), false);
  assert.equal(isServerRequest("::not a url", "fetch", "not-an-origin"), false);
});
