import assert from "node:assert/strict";
import { test } from "node:test";

import { ALGO_VERSION } from "../src/lib/video/auto-clip.ts";
import { autoMetaWord, editLabel, pickupQueue, PLAYER_WAITING_LINE, playerAutoLine } from "../src/lib/video/auto-lines.ts";
import { analysesAfterStop, AUTO_CLIP_KEY, autoClipOn, OLD_AUTO_CLIP_KEY, setAutoClipOn, subscribeAutoClip } from "../src/lib/video/auto-switch.ts";
import { markIn, markRange } from "../src/lib/video/clip-mark.ts";
import { startRange } from "../src/lib/video/clip-range.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import { cutRange } from "../src/lib/video/cut.ts";
import type { ClipIndexEntry } from "../src/lib/video/index-store.ts";

function memory(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}
const throwing = { getItem: (): string | null => { throw new Error("blocked"); } };

test("autoClipOn (clip-auto-on): absent = on, \"off\" = off, another value on; unreadable or no storage = off", () => {
  assert.equal(AUTO_CLIP_KEY, "famprove.clips.autoClipV2");
  assert.equal(autoClipOn(memory()), true, "absent");
  assert.equal(autoClipOn(memory({ [AUTO_CLIP_KEY]: "off" })), false);
  assert.equal(autoClipOn(memory({ [AUTO_CLIP_KEY]: "on" })), true, "another value");
  assert.equal(autoClipOn(throwing), false, "unreadable");
  assert.equal(autoClipOn(null), false, "no storage");
});

test("autoClipOn (clip-auto-on): the old key is ignored and removed, so a phone left off by the park turns on once", () => {
  const parked = memory({ [OLD_AUTO_CLIP_KEY]: "on" });
  assert.equal(autoClipOn(parked), true, "the old \"on\" doesn't matter");
  assert.equal(parked.getItem(OLD_AUTO_CLIP_KEY), null, "removed");
  const offByPark = memory(); // the park's off = the old key absent
  assert.equal(autoClipOn(offByPark), true, "on once");
  const oldOther = memory({ [OLD_AUTO_CLIP_KEY]: "off", [AUTO_CLIP_KEY]: "off" });
  assert.equal(autoClipOn(oldOther), false, "the new key decides");
  assert.equal(oldOther.getItem(OLD_AUTO_CLIP_KEY), null);
  assert.equal(autoClipOn({ getItem: (k) => (k === OLD_AUTO_CLIP_KEY ? "on" : null) }), true, "a store without removeItem still reads");
});

test("setAutoClipOn: off writes \"off\", on removes the key (and the old one), subscribers hear both; a blocked storage reads as before", () => {
  const s = memory({ [OLD_AUTO_CLIP_KEY]: "on" });
  let heard = 0;
  const off = subscribeAutoClip(() => heard++);
  setAutoClipOn(s, false);
  assert.equal(s.getItem(AUTO_CLIP_KEY), "off");
  assert.equal(s.getItem(OLD_AUTO_CLIP_KEY), null);
  assert.equal(autoClipOn(s), false);
  setAutoClipOn(s, true);
  assert.equal(s.getItem(AUTO_CLIP_KEY), null);
  assert.equal(autoClipOn(s), true);
  assert.equal(heard, 2);
  off();
  setAutoClipOn(s, false);
  assert.equal(heard, 2, "unsubscribed");
  const blocked = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => undefined };
  assert.doesNotThrow(() => setAutoClipOn(blocked, false));
  assert.equal(autoClipOn(blocked), true, "absent reads on");
});

const NONE = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null, durationS: 48 } as const;
const AUTO = { ...NONE, autoInS: 4.2, autoOutS: 39.6, autoStatus: "clipped" } as const;
const USER = { ...AUTO, clipInS: 5, clipOutS: 30 } as const;
const LOW = { ...NONE, autoStatus: "low_confidence" } as const;
const FAILED = { ...NONE, autoStatus: "failed" } as const;

test("labels: the meta word with the switch on (as before) and off (only klippet for the user's range)", () => {
  // [row, running, on, off]
  const table: [typeof NONE | typeof AUTO | typeof USER | typeof LOW | typeof FAILED, boolean, string | null, string | null][] = [
    [NONE, false, "venter på klip", null],
    [AUTO, false, "auto-klippet", null],
    [USER, false, "klippet", "klippet"],
    [LOW, false, "klip selv", null],
    [FAILED, false, "klip selv", null],
    [NONE, true, "klipper …", null],
    [USER, true, "klipper …", "klippet"],
  ];
  for (const [r, running, on, off] of table) {
    assert.equal(autoMetaWord("mp4", r, running, true), on, `on ${JSON.stringify(r)} ${running}`);
    assert.equal(autoMetaWord("mp4", r, running, true, true), on, "explicit on = default");
    assert.equal(autoMetaWord("mp4", r, running, true, false), off, `off ${JSON.stringify(r)} ${running}`);
  }
  assert.equal(autoMetaWord("webm", USER, false, true, false), null, "WebM: none either way");
  assert.equal(autoMetaWord("mp4", null, false, true, false), null, "no server row");
});

test("labels: the player's auto line and the edit button with the switch on and off", () => {
  assert.deepEqual(playerAutoLine(null, null), { words: PLAYER_WAITING_LINE, figure: null }, "on: waiting");
  for (const status of [null, "low_confidence", "failed", "clipped"] as const) {
    assert.equal(playerAutoLine(status, null, true, false), null, `off: ${status}`);
    assert.equal(playerAutoLine(status, { pct: 40 }, true, false), null, `off, running: ${status}`);
  }
  assert.equal(editLabel(LOW), "Klip selv", "on");
  assert.equal(editLabel(FAILED), "Klip selv", "on");
  assert.equal(editLabel(LOW, false), "Klip");
  assert.equal(editLabel(FAILED, false), "Klip");
  assert.equal(editLabel(AUTO, false), "Klip");
  assert.equal(editLabel(NONE, false), "Klip");
  assert.equal(editLabel(USER, false), "Ret klip");
});

test("cutRange: auto ignored gives the user's range or none (never auto); the default keeps auto", () => {
  assert.deepEqual(cutRange(AUTO, "mp4"), { reason: "auto", range: { inS: 4.2, outS: 39.6 } }, "default = as before");
  assert.deepEqual(cutRange(AUTO, "mp4", { auto: false }), { reason: "none", range: null });
  assert.deepEqual(cutRange(USER, "mp4", { auto: false }), { reason: "user", range: { inS: 5, outS: 30 } });
  assert.deepEqual(cutRange(AUTO, "webm", { auto: false }), { reason: "webm", range: null });
});

test("markRange / markIn / startRange: auto ignored skips the auto in (the user's in, else 0)", () => {
  assert.equal(markIn(AUTO, null), 4.2, "default = the auto in");
  assert.equal(markIn(AUTO, null, false), 0);
  assert.equal(markIn(USER, null, false), 5);
  assert.equal(markIn(AUTO, 12.34, false), 12.3, "a pending Start still wins");
  assert.deepEqual(markRange(AUTO, null, 10, false), { kind: "ok", range: { inS: 0, outS: 10 } });
  assert.deepEqual(markRange(AUTO, null, 10), { kind: "ok", range: { inS: 4.2, outS: 10 } }, "default");
  assert.deepEqual(startRange(AUTO, false), { inS: 0, outS: 48 });
  assert.deepEqual(startRange(AUTO), { inS: 4.2, outS: 39.6 }, "default");
});

function row(n: number, recordedAt: string): VideoClipRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, date: recordedAt.slice(0, 10), session: 1, row: 20, set: 1, exerciseId: 1, variantId: null,
    recordedAt, durationS: 30, starred: false, clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null,
  };
}
function entry(r: VideoClipRow): ClipIndexEntry {
  return { id: r.id, setKey: { date: r.date, sessionNo: 1, row: 20, set: 1 }, ext: "mp4", recordedAt: r.recordedAt, durationS: 30, starred: false, starSynced: true, state: "done" };
}

test("pickup: the switch off takes nothing; on (the default) takes the due clip", () => {
  const now = new Date("2026-10-20T12:00:00+02:00");
  const r = row(1, "2026-10-20T09:00:00+02:00");
  assert.deepEqual(pickupQueue([entry(r)], [r], now).map((x) => x.id), [r.id]);
  assert.deepEqual(pickupQueue([entry(r)], [r], now, {}, true).map((x) => x.id), [r.id]);
  assert.deepEqual(pickupQueue([entry(r)], [r], now, {}, false), []);
});

test("pickup (clip-auto-on): a clip analysed with version 3 (PAD_S 0.5) runs again once; version 4 doesn't", () => {
  const now = new Date("2026-10-31T12:00:00+01:00");
  const r: VideoClipRow = { ...row(2, "2026-10-30T09:00:00+01:00"), autoInS: 2.5, autoOutS: 18.0, autoStatus: "clipped" };
  assert.equal(ALGO_VERSION, 4);
  assert.deepEqual(pickupQueue([entry(r)], [r], now, { [r.id]: 3 }).map((x) => x.id), [r.id], "version 3: due");
  assert.deepEqual(pickupQueue([entry(r)], [r], now, {}).map((x) => x.id), [r.id], "none recorded = 1: due");
  assert.deepEqual(pickupQueue([entry(r)], [r], now, { [r.id]: 4 }), [], "version 4: done");
  const cut: VideoClipRow = { ...r, autoInS: null, autoOutS: null, autoStatus: null };
  assert.deepEqual(pickupQueue([entry(cut)], [cut], now, { [r.id]: 4 }).map((x) => x.id), [r.id], "a cut clip (auto_* null) is due by its null status, whatever the version");
});

test("Fokus after Stop: an analysis (and its slot) only for MP4 with the switch on", () => {
  assert.equal(analysesAfterStop("mp4", true), true);
  assert.equal(analysesAfterStop("mp4", false), false);
  assert.equal(analysesAfterStop("webm", true), false);
  assert.equal(analysesAfterStop("webm", false), false);
});
