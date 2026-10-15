// Tester's invariant for fokus-flow §3 (2026-10-16): random tick sequences with freezes, hidden
// spells and a backwards clock never buzz more than once, never late, never past a freeze.
import assert from "node:assert/strict";
import { test } from "node:test";

import { GAP_MS, restSignal } from "../src/lib/rest-signal.ts";

const SINCE = "2026-10-15T16:00:00.000Z";
const T = Date.parse(SINCE);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("rest signal invariant: at most one buzz, only on a visible look that crossed Min from a look ≤ 2.5 s before", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const rand = rng(seed);
    const min = 60 + Math.floor(rand() * 240);
    const calls: number[] = [];
    const s = restSignal(SINCE, min, { vibrate: (p: number) => (calls.push(p), true) });
    let now = T + Math.floor(rand() * (min + 30) * 1000); // first look: before or after Min (a reload)
    let prev: number | null = null;
    let fired = 0;
    for (let i = 0; i < 600; i++) {
      const visible = rand() > 0.1;
      const r = s.tick(now, visible);
      if (r) {
        fired += 1;
        assert.ok(prev !== null, `seed ${seed}: never on the first look`);
        assert.ok(now - prev <= GAP_MS, `seed ${seed}: never after a freeze`);
        assert.ok(now - T >= min * 1000 && prev - T < min * 1000, `seed ${seed}: crossed Min on this look`);
        assert.ok(visible, `seed ${seed}: visible`);
      }
      prev = now;
      const roll = rand();
      now += roll < 0.03 ? 3_000 + Math.floor(rand() * 120_000) : roll < 0.05 ? -Math.floor(rand() * 5_000) : 200 + Math.floor(rand() * 900);
    }
    assert.ok(fired <= 1, `seed ${seed}: fired ${fired}`);
    assert.equal(calls.length, fired, `seed ${seed}`);
    assert.ok(calls.every((c) => c === 200));
  }
});

test("rest signal boundary: a 2.5 s gap across Min still buzzes; a 2.501 s gap does not", () => {
  const on: number[] = [];
  const a = restSignal(SINCE, 180, { vibrate: (p: number) => (on.push(p), true) });
  a.tick(T + 177_600, true);
  assert.equal(a.tick(T + 180_100, true), true);
  assert.deepEqual(on, [200]);
  const off: number[] = [];
  const b = restSignal(SINCE, 180, { vibrate: (p: number) => (off.push(p), true) });
  b.tick(T + 177_599, true);
  assert.equal(b.tick(T + 180_100, true), false);
  assert.equal(b.tick(T + 181_000, true), false);
  assert.deepEqual(off, []);
});
