import assert from "node:assert/strict";
import { test } from "node:test";

import { liftFamily } from "../src/lib/video/auto-clip.ts";
import { AUTO_LAST_KEY, type AutoLast, lastOf, readAutoLast, recordAutoLast } from "../src/lib/video/auto-last.ts";
import type { AutoOutcome, AutoSummary } from "../src/lib/video/auto-run.ts";
import { countLine, summaryLine, summaryText } from "../src/lib/video/clip-summary.ts";

const AT = Date.UTC(2026, 9, 20, 12, 2);
const PLAY = { mode: "play", why: "afspil" } as const;
const SUMMARY: AutoSummary = { joint: "hips", validShare: 0.934, peaksUp: 4, peaksDown: 7, chosen: 1, expected: 5, repLengths: [2.1, 2.4] };
const memStore = () => {
  const mem = new Map<string, string>();
  return { mem, store: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
};

test("lastOf keeps the summary on clipped and low_confidence only; it survives the store", () => {
  const low: AutoOutcome = { kind: "low_confidence", reason: "count", saved: true, mode: PLAY, runMs: 22_000, summary: SUMMARY };
  const clipped: AutoOutcome = { kind: "clipped", inS: 1, outS: 9, saved: true, mode: PLAY, runMs: 20_000, summary: SUMMARY };
  assert.deepEqual(lastOf(low, AT), { kind: "low_confidence", mode: "play", why: "afspil", reason: "count", runMs: 22_000, summary: SUMMARY, at: AT });
  assert.deepEqual(lastOf(clipped, AT).summary, SUMMARY);
  const failed: AutoOutcome = { kind: "failed", saved: true, error: { step: "timeout", message: "over 108 s", reached: null }, mode: PLAY, runMs: 1 };
  assert.equal(lastOf(failed, AT).summary, undefined);
  assert.equal(lastOf({ kind: "aborted", reason: "afbrudt", mode: null, runMs: 0 }, AT).summary, undefined);
  const { mem, store } = memStore();
  recordAutoLast(store, "a", low, AT);
  assert.deepEqual(readAutoLast(store).a, lastOf(low, AT));
  // An unreadable field is null (missing, never 0); a junk summary is dropped, the record kept.
  mem.set(AUTO_LAST_KEY, JSON.stringify({ a: { kind: "low_confidence", at: AT, summary: { joint: "nose", validShare: "x", chosen: 2, repLengths: [1, "2"] } }, b: { kind: "clipped", at: AT, summary: 5 } }));
  const read = readAutoLast(store);
  assert.deepEqual(read.a?.summary, { joint: null, validShare: null, peaksUp: null, peaksDown: null, chosen: null, expected: null, repLengths: null });
  assert.equal(read.b?.kind, "clipped");
  assert.equal(read.b?.summary, undefined);
});

const CLIP = { name: "Squat", set: 2, durationS: 51.8, serverStatus: "low_confidence" };
const last = (o: AutoOutcome): AutoLast => lastOf(o, AT);

test("summaryLine per outcome kind", () => {
  assert.equal(
    summaryLine(CLIP, last({ kind: "low_confidence", reason: "count", saved: true, mode: PLAY, runMs: 22_000, summary: SUMMARY })),
    "Squat sæt 2 · 51,8 s · low_confidence · low_confidence · count · fundet 4/5 · hips · gyldige 93 % · play · 22 s",
  );
  assert.equal(
    summaryLine({ ...CLIP, serverStatus: "clipped" }, last({ kind: "clipped", inS: 1, outS: 9, saved: true, mode: PLAY, runMs: 20_000, summary: { ...SUMMARY, chosen: -1, expected: 7 } })),
    "Squat sæt 2 · 51,8 s · clipped · clipped · fundet 7/7 · hips · gyldige 93 % · play · 20 s",
  );
  const few: AutoSummary = { joint: "knees", validShare: 0.12, peaksUp: null, peaksDown: null, chosen: null, expected: 5, repLengths: null };
  assert.equal(
    summaryLine(CLIP, last({ kind: "low_confidence", reason: "few_frames", saved: true, mode: PLAY, runMs: 18_000, summary: few })),
    "Squat sæt 2 · 51,8 s · low_confidence · low_confidence · few_frames · fundet –/5 · knees · gyldige 12 % · play · 18 s",
  );
  assert.equal(
    summaryLine({ ...CLIP, serverStatus: "failed" }, last({ kind: "failed", saved: true, error: { step: "timeout", message: "over 108 s", reached: null }, mode: PLAY, runMs: 1_096_354 })),
    "Squat sæt 2 · 51,8 s · failed · failed · timeout · play · 18 min",
  );
  assert.equal(
    summaryLine({ ...CLIP, serverStatus: null }, last({ kind: "aborted", reason: "siden blev skjult", mode: PLAY, runMs: 4_000 })),
    "Squat sæt 2 · 51,8 s · venter · aborted · siden blev skjult · play · 4 s",
  );
  assert.equal(summaryLine({ ...CLIP, serverStatus: null }, last({ kind: "skipped" })), "Squat sæt 2 · 51,8 s · venter · skipped");
  assert.equal(summaryLine({ ...CLIP, durationS: null, serverStatus: null }, null), "Squat sæt 2 · – · venter · ingen lokal kørsel");
});

test("countLine: low_confidence by reason first, then the other kinds and the clips without a run", () => {
  const low = (reason: "count" | "few_frames"): AutoLast => ({ kind: "low_confidence", mode: "play", why: null, reason, runMs: 1, at: AT });
  const ok: AutoLast = { kind: "clipped", mode: "play", why: null, runMs: 1, at: AT };
  assert.equal(countLine([low("few_frames"), low("count"), low("count"), ok, null, null, ok, ok]), "low_confidence: count 2 · few_frames 1; clipped 3; ingen lokal kørsel 2");
  assert.equal(countLine([]), "low_confidence: 0");
  assert.equal(summaryText([{ clip: CLIP, last: null }]), "Squat sæt 2 · 51,8 s · low_confidence · ingen lokal kørsel\nlow_confidence: 0; ingen lokal kørsel 1");
});

test("liftFamily on the sheet's real TYPE strings", () => {
  for (const t of ["QUADS/ADDUCTORS", "QUADS/ADDUCTORS/GLUTES", "SQUAT", "DEADLIFT", "HAMSTRINGS", "QUADS"]) assert.equal(liftFamily(t), "lower", t);
  for (const t of ["BENCH", "CHEST/SHOULDERS", "LATS/MIDDLE BACK", "UPPER BACK"]) assert.equal(liftFamily(t), "upper", t);
});
