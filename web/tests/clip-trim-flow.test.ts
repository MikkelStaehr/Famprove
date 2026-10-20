import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { memoryClipIndex, type ClipIndexEntry } from "../src/lib/video/index-store.ts";
import { memoryClipFiles } from "../src/lib/video/opfs.ts";
import { finishTrim, startTrim, type TrimClipResult } from "../src/lib/video/trim.ts";
import {
  clockLength,
  cutPoints,
  doneAnnouncement,
  doneLine,
  endAt,
  failedLine,
  finishedLine,
  NO_POINTS,
  pointsLine,
  secondsLeft,
  startAt,
  storedLine,
  storedPoints,
  type TrimState,
  REFUSED_LINE,
  trimStep,
  undoneLine,
} from "../src/lib/video/trim-flow.ts";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const T0 = new Date("2026-10-20T16:00:00.000Z");

/** The body of `function name(` in a source file, up to the next top-level-ish `  function` / `  async function`. */
function body(file: string, name: string): string {
  const src = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} in ${file}`);
  const rest = src.slice(i + 1);
  const j = rest.search(/\n  (async )?function /);
  return j < 0 ? rest : rest.slice(0, j);
}

test("the player's flow: pending → cutting → done with a countdown → finished at 0", () => {
  let s: TrimState = { kind: "idle" };
  const c = cutPoints({ inS: 12.3, outS: 48 }, 51.8);
  assert.deepEqual(c, { inS: 12.3, outS: 48 });
  s = trimStep(s, { kind: "cut", inS: 12.3, outS: 48 });
  assert.equal(s.kind, "cutting");
  const deadline = new Date(T0.getTime() + 10_000).toISOString();
  s = trimStep(s, { kind: "result", result: { kind: "done", fromS: 51.8, toS: 36.2, deadline } });
  assert.deepEqual(s, { kind: "done", fromS: 51.8, toS: 36.2, deadline });
  assert.equal(secondsLeft(deadline, T0.getTime()), 10);
  assert.equal(secondsLeft(deadline, T0.getTime() + 1_500), 9);
  assert.equal(secondsLeft(deadline, T0.getTime() + 10_000), 0);
  assert.equal(doneLine(36.2, 51.8), "Klippet til 0:36,2 (fra 0:51,8)");
  assert.equal(doneAnnouncement(36.2), "Klippet til 0:36,2. Fortryd muligt i 10 sekunder.");
  const f = trimStep(s, { kind: "finished", freed: 14_000_000 });
  assert.deepEqual(f, { kind: "finished", toS: 36.2, freed: 14_000_000 });
  assert.match(finishedLine(36.2, 14_000_000), /^Klippet til 0:36,2 · .*MB frigjort\.$/);
  assert.equal(finishedLine(36.2, null), "Klippet til 0:36,2.");
});

test("the player's flow: done → undone by Fortryd; a failed cut keeps the points for Prøv igen", () => {
  const deadline = new Date(T0.getTime() + 10_000).toISOString();
  const done: TrimState = { kind: "done", fromS: 51.8, toS: 36.2, deadline };
  assert.deepEqual(trimStep(done, { kind: "undone", fromS: 51.8 }), { kind: "undone", fromS: 51.8 });
  assert.equal(undoneLine(51.8), "Fortrudt · hele videoen er tilbage (0:51,8).");
  // finished and undone exclude each other
  assert.equal(trimStep({ kind: "undone", fromS: 51.8 }, { kind: "finished", freed: 1 }).kind, "undone");
  const failed = trimStep({ kind: "cutting", inS: 12.3, outS: 48 }, { kind: "result", result: { kind: "failed", space: true } });
  assert.deepEqual(failed, { kind: "failed", space: true, inS: 12.3, outS: 48 });
  assert.equal(failedLine(true), "Klippet lykkedes ikke. Telefonen mangler plads. Hele videoen er urørt.");
  assert.equal(failedLine(false), "Klippet lykkedes ikke. Hele videoen er urørt.");
  assert.equal(trimStep(failed, { kind: "cut", inS: 12.3, outS: 48 }).kind, "cutting");
});

test("Slut her only sets the out point: in = the pending Start, else 0; refused under 1,0 s; no write", () => {
  assert.deepEqual(endAt({ inS: 12.3, outS: null }, 48, 51.8), { kind: "ok", points: { inS: 12.3, outS: 48 } });
  assert.deepEqual(endAt(NO_POINTS, 30, 51.8), { kind: "ok", points: { inS: 0, outS: 30 } });
  assert.deepEqual(endAt({ inS: 12.3, outS: null }, 12.8, 51.8), { kind: "refused", inS: 12.3 });
  assert.equal(pointsLine(12.3, 48), "Start 12,3 s · Slut 48,0 s · 35,7 s");
  // a Start past out − 1,0 clears out
  assert.deepEqual(startAt({ inS: 0, outS: 30 }, 29.5), { points: { inS: 29.5, outS: null }, cleared: true });
  assert.deepEqual(startAt({ inS: 0, outS: 30 }, 10), { points: { inS: 10, outS: 30 }, cleared: false });
  // the component's Slut her and Start her call no server action
  for (const fn of ["markEnd", "markStart"]) {
    const b = body("ClipLibrary.tsx", fn);
    assert.doesNotMatch(b, /setClipRange|sendClipRange|onTrim|startTrim/, `${fn} writes nothing`);
  }
});

test("Gem klip shows only with both points valid", () => {
  assert.equal(cutPoints({ inS: 12.3, outS: null }, 51.8), null);
  assert.equal(cutPoints({ inS: 12.3, outS: 13 }, 51.8), null);
  assert.deepEqual(cutPoints({ inS: null, outS: 5 }, 51.8), { inS: 0, outS: 5 });
});

test("the editor's Gem klip cuts through startTrim, never setClipRange", () => {
  const cut = body("ClipEditor.tsx", "cut");
  assert.match(cut, /onCut\(/);
  assert.doesNotMatch(cut, /sendClipRange|setClipRange/);
  const editor = readFileSync(new URL("../src/components/ClipEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /onClick=\{\(\) => void cut\(range\)\}/);
  assert.match(editor, /\{CANCEL\}/);
  const lib = readFileSync(new URL("../src/components/ClipLibrary.tsx", import.meta.url), "utf8");
  assert.match(lib, /onCut=\{\(r\) => onTrim\(r\.inS, r\.outS\)\}/);
  assert.match(body("ClipLibrary.tsx", "runTrim"), /startTrim\(deps, id, inS, outS, new Date\(\)\)/);
});

test("an old stored range opens as pending points with its line; the auto range never pre-fills", () => {
  assert.deepEqual(storedPoints({ clipInS: 12.3, clipOutS: 48 }), { inS: 12.3, outS: 48 });
  assert.deepEqual(storedPoints({ clipInS: null, clipOutS: null }), NO_POINTS);
  assert.deepEqual(storedPoints(null), NO_POINTS);
  assert.equal(storedLine(12.3, 48), "Dit klip 12,3–48,0 s · ikke klippet endnu");
  assert.equal(clockLength(51.8), "0:51,8");
  assert.equal(clockLength(72.4), "1:12,4");
});

test("the fixture-style cut (fakes, no write) commits once at 0", async () => {
  const e: ClipIndexEntry = {
    id: ID, setKey: { date: "2026-10-20", sessionNo: 1, row: 30, set: 1 }, ext: "mp4", recordedAt: "2026-10-20T10:00:00+02:00",
    durationS: 51.8, starred: false, starSynced: true, state: "done",
  };
  const index = memoryClipIndex([e]);
  const files = memoryClipFiles();
  await files.writeFile(`${ID}.mp4`, new Blob([new Uint8Array(32)]));
  const writes: number[] = [];
  const trim = async (i: { id: string; durationS: number }): Promise<TrimClipResult> => {
    writes.push(i.durationS);
    return { ok: true, dev: true, durationS: i.durationS };
  };
  const cut = async (_b: Blob, inS: number, outS: number) => ({ blob: new Blob([new Uint8Array(16)]), actual: { startS: inS - 0.5, endS: outS } });
  const r = await startTrim({ index, files, trim, cut }, ID, 12.3, 48, T0);
  assert.equal(r.kind, "done");
  if (r.kind !== "done") return;
  assert.equal(r.toS, 36.2);
  assert.deepEqual(writes, []);
  assert.equal(await finishTrim({ index, files, trim, cut }, ID, new Date(T0.getTime() + 5_000)), "waiting");
  assert.deepEqual(writes, []);
  assert.equal(await finishTrim({ index, files, trim, cut }, ID, new Date(T0.getTime() + 10_000)), "done");
  assert.deepEqual(writes, [36.2]);
});

test("at 0 a permanent refusal: done → refused, with its line; other states ignore it", () => {
  const done = { kind: "done", fromS: 51.8, toS: 36.2, deadline: "2026-10-20T16:00:10.000Z" } as const;
  assert.deepEqual(trimStep(done, { kind: "refused" }), { kind: "refused" });
  assert.deepEqual(trimStep({ kind: "idle" }, { kind: "refused" }), { kind: "idle" });
  assert.equal(REFUSED_LINE, "Klippet kunne ikke gemmes. Hele videoen er tilbage.");
});
