import assert from "node:assert/strict";
import { test } from "node:test";

import { ALGO_VERSION } from "../src/lib/video/auto-clip.ts";
import { AUTO_LAST_KEY, lastLine, lastOf, readAutoLast, recordAutoLast, recordRun, runText, whenText } from "../src/lib/video/auto-last.ts";
import type { AutoOutcome } from "../src/lib/video/auto-run.ts";
import { AUTO_VERSION_KEY } from "../src/lib/video/auto-version.ts";
import { abortWhenHidden, PoseError, type VisibilityDoc } from "../src/lib/video/pose-run.ts";

const memStore = () => {
  const mem = new Map<string, string>();
  return { mem, store: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
};
// 2026-10-20 14:02 Copenhagen (CEST, UTC+2)
const AT = Date.UTC(2026, 9, 20, 12, 2);
const PLAY = { mode: "play", why: "afspil", keyframes: "nøglebilleder op til 4,1 s" } as const;
const OUTCOMES: Record<AutoOutcome["kind"], AutoOutcome> = {
  clipped: { kind: "clipped", inS: 23.8, outS: 40.8, saved: true, mode: PLAY, runMs: 26_600 },
  low_confidence: { kind: "low_confidence", reason: "count", saved: true, mode: PLAY, runMs: 22_000 },
  failed: { kind: "failed", saved: true, error: { step: "timeout", message: "over 108 s", reached: null }, mode: PLAY, runMs: 1_096_354 },
  aborted: { kind: "aborted", reason: "siden blev skjult", mode: PLAY, runMs: 4_000 },
  skipped: { kind: "skipped" },
};

test("last outcome store: write, read, another clip kept; unreadable is empty; a failing store is ignored", () => {
  const { mem, store } = memStore();
  assert.deepEqual(readAutoLast(store), {});
  recordAutoLast(store, "a", OUTCOMES.failed, AT);
  recordAutoLast(store, "b", OUTCOMES.low_confidence, AT);
  const read = readAutoLast(store);
  assert.deepEqual(read.a, { kind: "failed", mode: "play", why: "afspil", step: "timeout", message: "over 108 s", runMs: 1_096_354, at: AT });
  assert.deepEqual(read.b, { kind: "low_confidence", mode: "play", why: "afspil", reason: "count", runMs: 22_000, at: AT });
  mem.set(AUTO_LAST_KEY, "{not json");
  assert.deepEqual(readAutoLast(store), {});
  mem.set(AUTO_LAST_KEY, JSON.stringify([1]));
  assert.deepEqual(readAutoLast(store), {});
  mem.set(AUTO_LAST_KEY, JSON.stringify({ x: { kind: "bogus", at: 1 }, y: { kind: "aborted", at: 2, reason: "afbrudt" } }));
  assert.deepEqual(Object.keys(readAutoLast(store)), ["y"], "an unreadable entry is left out");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(readAutoLast(broken), {});
  recordAutoLast(broken, "a", OUTCOMES.failed, AT); // never throws
  recordAutoLast(null, "a", OUTCOMES.failed, AT);
});

test("recordRun: every outcome kind is the last outcome; only a saved run records the version", () => {
  for (const [kind, out] of Object.entries(OUTCOMES)) {
    const { mem, store } = memStore();
    recordRun(store, "c", out, AT);
    const last = readAutoLast(store).c;
    assert.equal(last?.kind, kind);
    assert.deepEqual(last, lastOf(out, AT));
    const versions = mem.get(AUTO_VERSION_KEY);
    if (kind === "aborted" || kind === "skipped") assert.equal(versions, undefined, `${kind} records no version`);
    else assert.deepEqual(JSON.parse(versions!), { c: ALGO_VERSION });
  }
  const { mem, store } = memStore();
  recordRun(store, "d", { ...OUTCOMES.failed, saved: false } as AutoOutcome, AT);
  assert.equal(mem.get(AUTO_VERSION_KEY), undefined, "an unsaved run is re-run");
  assert.equal(readAutoLast(store).d?.kind, "failed", "but its outcome is still visible");
});

test("the log's first line per outcome", () => {
  assert.equal(lastLine(null), "baggrund: ingen kørsel endnu");
  assert.equal(lastLine(lastOf(OUTCOMES.failed, AT)), "baggrund: failed · trin pose · timeout: over 108 s · afspil · 18 min · 20. okt. 14:02");
  assert.equal(lastLine(lastOf(OUTCOMES.low_confidence, AT)), "baggrund: low_confidence · count · afspil · 22 s · 20. okt. 14:02");
  assert.equal(lastLine(lastOf(OUTCOMES.aborted, AT)), "baggrund: aborted · siden blev skjult · afspil · 4 s · 20. okt. 14:02");
  assert.equal(lastLine(lastOf(OUTCOMES.clipped, AT)), "baggrund: clipped · afspil · 27 s · 20. okt. 14:02");
  assert.equal(lastLine(lastOf(OUTCOMES.skipped, AT)), "baggrund: skipped · 20. okt. 14:02");
  assert.equal(
    lastLine({ kind: "failed", mode: null, why: null, step: "model", message: "net", runMs: 900, at: AT }),
    "baggrund: failed · trin model · net · 1 s · 20. okt. 14:02",
  );
  assert.equal(whenText(Date.UTC(2026, 0, 5, 7, 9)), "5. jan. 08:09", "CET in winter");
  assert.equal(runText(59_400), "59 s");
  assert.equal(runText(60_000), "1 min");
});

test("abortWhenHidden: aborts at once or on hide, for every mode (runPose calls it before choosing a pass); unwatch stops it", () => {
  const fake = (state: DocumentVisibilityState) => {
    const ls = new Set<() => void>();
    const doc = {
      visibilityState: state,
      addEventListener: (_t: string, l: () => void) => void ls.add(l),
      removeEventListener: (_t: string, l: () => void) => void ls.delete(l),
    };
    return { doc, fire: () => ls.forEach((l) => l()), count: () => ls.size };
  };
  const hiddenNow = fake("hidden");
  const c1 = new AbortController();
  abortWhenHidden(hiddenNow.doc as unknown as VisibilityDoc, c1); // a structural fake of Document's three members
  assert.ok(c1.signal.aborted && c1.signal.reason instanceof PoseError && c1.signal.reason.reason === "aborted" && c1.signal.reason.message === "siden blev skjult");
  const later = fake("visible");
  const c2 = new AbortController();
  const unwatch = abortWhenHidden(later.doc as unknown as VisibilityDoc, c2);
  later.fire();
  assert.equal(c2.signal.aborted, false, "visible: runs on");
  later.doc.visibilityState = "hidden";
  later.fire();
  assert.equal(c2.signal.aborted, true, "the screen off or the page hidden aborts");
  unwatch();
  assert.equal(later.count(), 0);
});
