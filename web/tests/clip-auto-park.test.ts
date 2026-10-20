import assert from "node:assert/strict";
import { test } from "node:test";

import { autoMetaWord, editLabel, pickupQueue, PLAYER_WAITING_LINE, playerAutoLine } from "../src/lib/video/auto-lines.ts";
import { analysesAfterStop, AUTO_CLIP_KEY, autoClipOn, setAutoClipOn, subscribeAutoClip } from "../src/lib/video/auto-switch.ts";
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

test("autoClipOn: on only for \"on\"; absent, another value, unreadable or no storage = off", () => {
  assert.equal(autoClipOn(memory()), false, "absent");
  assert.equal(autoClipOn(memory({ [AUTO_CLIP_KEY]: "on" })), true);
  assert.equal(autoClipOn(memory({ [AUTO_CLIP_KEY]: "true" })), false, "another value");
  assert.equal(autoClipOn(throwing), false, "unreadable");
  assert.equal(autoClipOn(null), false, "no storage");
});

test("setAutoClipOn: on writes \"on\", off removes the key, subscribers hear both; a blocked storage stays off", () => {
  const s = memory();
  let heard = 0;
  const off = subscribeAutoClip(() => heard++);
  setAutoClipOn(s, true);
  assert.equal(s.getItem(AUTO_CLIP_KEY), "on");
  assert.equal(autoClipOn(s), true);
  setAutoClipOn(s, false);
  assert.equal(s.getItem(AUTO_CLIP_KEY), null);
  assert.equal(heard, 2);
  off();
  setAutoClipOn(s, true);
  assert.equal(heard, 2, "unsubscribed");
  const blocked = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => undefined };
  assert.doesNotThrow(() => setAutoClipOn(blocked, true));
  assert.equal(autoClipOn(blocked), false);
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

test("Fokus after Stop: an analysis (and its slot) only for MP4 with the switch on", () => {
  assert.equal(analysesAfterStop("mp4", true), true);
  assert.equal(analysesAfterStop("mp4", false), false);
  assert.equal(analysesAfterStop("webm", true), false);
  assert.equal(analysesAfterStop("webm", false), false);
});
