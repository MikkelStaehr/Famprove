import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeleteClipResult, VideoClipRow } from "../src/lib/video/clips.ts";
import { markSaved } from "../src/lib/video/delete.ts";
import { clipFile, type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { memoryClipFiles } from "../src/lib/video/opfs.ts";
import {
  declineRetention,
  deleteInText,
  deleteNow,
  KEEP_WEEKS_KEY,
  keepDays,
  missingSavedAt,
  readRetention,
  retentionPrompt,
  retentionRunDue,
  selectionIds,
  selectRetention,
  setKeepWeeks,
  spaceRule,
} from "../src/lib/video/retention.ts";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const H = 60 * 60 * 1000;
const D = 24 * H;
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const entry = (id: string, over: Partial<ClipIndexEntry> = {}): ClipIndexEntry => ({
  id,
  setKey: { date: "2026-10-20", sessionNo: 1, row: 30, set: 1 },
  ext: "mp4",
  recordedAt: ago(3 * D),
  durationS: 40,
  starred: false,
  starSynced: true,
  state: "done",
  ...over,
});

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test("keep weeks 1/2/4/8: a clip is old past weeks × 7 days, capped at the server's 56 days", () => {
  const clips = [entry("d6", { recordedAt: ago(6 * D) }), entry("d10", { recordedAt: ago(10 * D) }), entry("d20", { recordedAt: ago(20 * D) }), entry("d40", { recordedAt: ago(40 * D) }), entry("d60", { recordedAt: ago(60 * D) })];
  const old = (w: 1 | 2 | 4 | 8) => selectRetention(clips, [], NOW, w).old.map((e) => e.id);
  assert.deepEqual(old(1), ["d10", "d20", "d40", "d60"]);
  assert.deepEqual(old(2), ["d20", "d40", "d60"]);
  assert.deepEqual(old(4), ["d40", "d60"]);
  assert.deepEqual(old(8), ["d60"]);
  assert.deepEqual(selectRetention(clips, [], NOW, null).old.map((e) => e.id), ["d60"]); // the 8-week rule
  assert.equal(keepDays({ kind: "on", weeks: 8 }), 56);
  assert.equal(keepDays({ kind: "declined" }), 56);
});

test("the 24 h rule: gemt ✓ with savedAt ≥ 24 h ago is deleted; 23 h is not; only while the rules are on", () => {
  const clips = [entry("s30", { savedOut: true, savedAt: ago(30 * H) }), entry("s6", { savedOut: true, savedAt: ago(6 * H) }), entry("s24", { savedOut: true, savedAt: ago(24 * H) })];
  assert.deepEqual(selectRetention(clips, [], NOW, 2).saved.map((e) => e.id), ["s30", "s24"]);
  assert.deepEqual(selectRetention(clips, [], NOW, null).saved, []);
});

test("★ (phone or server), a pending trim, a pending delete and a recording are never selected", () => {
  const old = ago(30 * D);
  const clips = [
    entry("star", { recordedAt: old, starred: true, savedOut: true, savedAt: ago(2 * D) }),
    entry("srvstar", { recordedAt: old }),
    entry("trim", { recordedAt: old, pendingTrim: { deadline: NOW.toISOString(), originalFileName: "x.mp4", originalDurationS: 40, newDurationS: 10 } }),
    entry("del", { recordedAt: old, pendingDelete: { deadline: NOW.toISOString(), batch: "b" } }),
    entry("rec", { recordedAt: old, state: "recording" }),
    entry("ok", { recordedAt: old }),
  ];
  const rows = [{ id: "srvstar", starred: true, recordedAt: old } as unknown as VideoClipRow]; // only the fields the rule reads
  assert.deepEqual(selectionIds(selectRetention(clips, rows, NOW, 1)), ["ok"]);
  assert.equal(deleteInText(clips[0]!, NOW, true), null); // ★ never reads "slettes om"
});

test("a pre-slice gemt ✓ clip gets savedAt now, so it is not deleted on the first open", () => {
  const pre = entry("pre", { savedOut: true });
  const stamped = missingSavedAt([pre, entry("not"), entry("has", { savedOut: true, savedAt: ago(2 * D) })], NOW);
  assert.deepEqual(stamped.map((e) => [e.id, e.savedAt]), [["pre", NOW.toISOString()]]);
  assert.deepEqual(selectRetention(stamped, [], NOW, 2).saved, []);
  assert.equal(deleteInText(stamped[0]!, NOW, true)?.text, "slettes om 24 t");
});

test("markSaved sets savedAt once; a later save doesn't extend it", async () => {
  const index = memoryClipIndex([entry("a")]);
  await markSaved({ index }, ["a"], new Date(NOW.getTime() - 30 * H));
  await markSaved({ index }, ["a"], NOW);
  assert.equal((await index.get("a"))?.savedAt, ago(30 * H));
});

test("slettes om: hours rounded down, under 1 h, due; screen reader words", () => {
  assert.deepEqual(deleteInText({ savedOut: true, savedAt: ago(6 * H - 1000), starred: false }, NOW, true), { text: "slettes om 18 t", sr: "slettes om 18 timer" });
  assert.equal(deleteInText({ savedOut: true, savedAt: ago(23.5 * H), starred: false }, NOW, true)?.text, "slettes om under 1 t");
  assert.equal(deleteInText({ savedOut: true, savedAt: ago(25 * H), starred: false }, NOW, true)?.text, "slettes ved næste åbning");
  assert.equal(deleteInText({ savedOut: true, savedAt: ago(6 * H), starred: false }, NOW, false), null);
});

test("the one-time ask: unasked until answered; Ikke nu = the 8-week rule, never asked again; a choice switches on", () => {
  const s = memStore();
  assert.deepEqual(readRetention(s), { kind: "unasked" });
  declineRetention(s);
  assert.deepEqual(readRetention(s), { kind: "declined" });
  assert.equal(readRetention(s), readRetention(s)); // a stable snapshot
  assert.equal(keepDays(readRetention(s)), 56);
  setKeepWeeks(s, 4);
  assert.deepEqual(readRetention(s), { kind: "on", weeks: 4 });
  assert.deepEqual(readRetention(memStore({ [KEEP_WEEKS_KEY]: "3" })), { kind: "unasked" }); // junk is not a choice
  assert.deepEqual(readRetention({ getItem: () => { throw new Error("blocked"); } }), { kind: "unasked" });
});

test("the prompt's words: N is the sum of its parts, a 0 part left out; space line singular uge", () => {
  assert.equal(retentionPrompt(5, 2, 2), "Oprydning sletter 7 klip: 5 ældre end 2 uger, 2 gemt for over et døgn siden. ★ beholdes.");
  assert.equal(retentionPrompt(0, 2, 2), "Oprydning sletter 2 klip: 2 gemt for over et døgn siden. ★ beholdes.");
  assert.equal(retentionPrompt(3, 0, 1), "Oprydning sletter 3 klip: 3 ældre end 1 uge. ★ beholdes.");
  assert.equal(spaceRule({ kind: "on", weeks: 1 }).text, "ældre end 1 uge slettes, gemte efter et døgn (");
  assert.equal(spaceRule({ kind: "unasked" }).text, "ældre end 8 uger slettes automatisk (");
});

test("once an hour: due with no run, after 60 min, or a clock that went back", () => {
  const t = NOW.getTime();
  assert.equal(retentionRunDue(null, t), true);
  assert.equal(retentionRunDue(String(t - 59 * 60 * 1000), t), false);
  assert.equal(retentionRunDue(String(t - H), t), true);
  assert.equal(retentionRunDue(String(t + H), t), true);
  assert.equal(retentionRunDue("junk", t), true);
});

test("deleteNow goes through clip-delete's flow: the server row, then the files, then the entry; ★ rechecked", async () => {
  const a = entry("a", { recordedAt: ago(30 * D) });
  const st = entry("st", { starred: true });
  const index = memoryClipIndex([a, st]);
  const files = memoryClipFiles();
  for (const e of [a, st]) await files.writeFile(clipFile(e), new Blob([new Uint8Array(4)]));
  const calls: string[] = [];
  const del = async (i: { readonly id: string }): Promise<DeleteClipResult> => {
    calls.push(`del ${i.id} file=${(await files.readFile(clipFile(a))) !== null} entry=${(await index.get(i.id)) !== null}`);
    return { ok: true, dev: false };
  };
  const r = await deleteNow({ index, files, del }, ["a", "st"], "b", NOW);
  assert.deepEqual(r, { done: ["a"], failed: [] });
  assert.deepEqual(calls, ["del a file=true entry=true"]);
  assert.equal(await index.get("a"), null);
  assert.equal(await files.readFile(clipFile(a)), null);
  assert.notEqual(await index.get("st"), null);
});

test("deleteNow: a failed row keeps the file and the marked entry for the next open", async () => {
  const a = entry("a");
  const index = memoryClipIndex([a]);
  const files = memoryClipFiles();
  await files.writeFile(clipFile(a), new Blob([new Uint8Array(4)]));
  const r = await deleteNow({ index, files, del: async (): Promise<DeleteClipResult> => ({ ok: false, reason: "failed" }) }, ["a"], "b", NOW);
  assert.deepEqual(r, { done: [], failed: ["a"] });
  assert.notEqual(await files.readFile(clipFile(a)), null);
  assert.notEqual((await index.get("a"))?.pendingDelete, undefined);
});
