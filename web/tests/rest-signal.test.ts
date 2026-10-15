import assert from "node:assert/strict";
import { test } from "node:test";

import { restSignal, type Vibrator } from "../src/lib/rest-signal.ts";

const SINCE = "2026-10-15T16:00:00.000Z";
const T = Date.parse(SINCE);
const at = (s: number): number => T + s * 1000;

function fakeNav(): { nav: Vibrator; calls: number[] } {
  const calls: number[] = [];
  return { nav: { vibrate: (p: number) => (calls.push(p), true) }, calls };
}

test("rest signal: vibrates once with 200 at Min, not on re-render, not at Max", () => {
  const { nav, calls } = fakeNav();
  const s = restSignal(SINCE, 180, nav);
  assert.equal(s.tick(at(0), true), false);
  assert.equal(s.tick(at(179), true), false);
  assert.equal(s.tick(at(180), true), true);
  assert.equal(s.tick(at(180), true), false); // a re-render at the same second
  assert.equal(s.tick(at(181), true), false);
  assert.equal(s.tick(at(300), true), false); // Max
  assert.equal(s.tick(at(400), true), false); // over Max
  assert.deepEqual(calls, [200]);
});

test("rest signal: a load or reload already past Min never vibrates", () => {
  const { nav, calls } = fakeNav();
  const s = restSignal(SINCE, 180, nav);
  assert.equal(s.tick(at(200), true), false);
  assert.equal(s.tick(at(201), true), false);
  assert.equal(s.tick(at(360), true), false);
  assert.deepEqual(calls, []);
});

test("rest signal: no Min (rest_min_s null) never vibrates; hidden at the crossing never vibrates later", () => {
  const a = fakeNav();
  const none = restSignal(SINCE, null, a.nav);
  for (const sec of [0, 180, 600]) none.tick(at(sec), true);
  assert.deepEqual(a.calls, []);
  const b = fakeNav();
  const hidden = restSignal(SINCE, 180, b.nav);
  hidden.tick(at(10), true);
  assert.equal(hidden.tick(at(185), false), false);
  assert.equal(hidden.tick(at(190), true), false);
  assert.deepEqual(b.calls, []);
});

test("rest signal: unsupported vibrate (no method, no navigator) is a silent no-op but still marks the moment", () => {
  const s = restSignal(SINCE, 180, {});
  s.tick(at(179), true);
  assert.equal(s.tick(at(180), true), true);
  const n = restSignal(SINCE, 180, undefined);
  n.tick(at(179), true);
  assert.equal(n.tick(at(180), true), true);
});

test("rest signal: a frozen page (no tick for a while) that wakes past Min never buzzes late", () => {
  const { nav, calls } = fakeNav();
  const s = restSignal(SINCE, 180, nav);
  assert.equal(s.tick(at(10), true), false);
  assert.equal(s.tick(at(11), true), false);
  assert.equal(s.tick(at(190), true), false); // screen locked from 11 s to 190 s: no ticks ran
  assert.equal(s.tick(at(191), true), false);
  assert.deepEqual(calls, []);
});

test("rest signal: a freeze that ends before Min stays armed", () => {
  const { nav, calls } = fakeNav();
  const s = restSignal(SINCE, 180, nav);
  assert.equal(s.tick(at(10), true), false);
  assert.equal(s.tick(at(100), true), false); // frozen 10 s to 100 s, still under Min
  assert.equal(s.tick(at(179), true), false);
  assert.equal(s.tick(at(180), true), true);
  assert.deepEqual(calls, [200]);
});
