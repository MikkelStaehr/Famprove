import assert from "node:assert/strict";
import { test } from "node:test";

import type { CutRange } from "../src/lib/video/cut.ts";
import {
  busyText,
  cutFileName,
  cutLine,
  formatRange,
  formatSeconds,
  keyframeLines,
  prepareClip,
  saveDoneLine,
  shareCutLine,
} from "../src/lib/video/cut-lines.ts";
import { clipFileNames, doneLine, type SaveClip, saveSequence } from "../src/lib/video/save.ts";
import { splitCount } from "../src/lib/video/cut-lines.ts";

const USER: CutRange = { reason: "user", range: { inS: 12.3, outS: 48 } };
const AUTO: CutRange = { reason: "auto", range: { inS: 12.3, outS: 48 } };

test("number format: one decimal, decimal comma, m:ss,d from 60 s, en-dash range", () => {
  assert.equal(formatSeconds(12.34), "12,3 s");
  assert.equal(formatSeconds(62.3), "1:02,3");
  assert.equal(formatSeconds(59.96), "1:00,0");
  assert.equal(formatRange(12.3, 48), "12,3–48,0 s");
  assert.equal(formatRange(12.3, 62.3), "0:12,3–1:02,3");
});

test("player cut line: user, automatic, none, WebM; no dot decimals", () => {
  assert.equal(cutLine(USER), "Klippet 12,3–48,0 s · 35,7 s");
  assert.equal(cutLine(AUTO), "Klippet 12,3–48,0 s · 35,7 s · automatisk");
  assert.equal(cutLine({ reason: "none", range: null }), null);
  assert.equal(cutLine({ reason: "webm", range: null }), "Kan ikke klippes på denne telefon. Gem og Del giver hele videoen.");
  for (const l of [cutLine(USER), cutLine(AUTO)]) assert.doesNotMatch(l ?? "", /\d\.\d/);
});

test("the cut's name is clip-save's name with ' klippet' before the extension; clipFileNames unchanged", () => {
  const rows = [
    { id: "a", kind: "clip", ext: "mp4", exercise: "Squat", variant: null, date: "2026-10-19", set: 2, recordedAt: "2026-10-19T10:00:00+02:00" },
  ] as const;
  const name = clipFileNames(rows).get("a");
  assert.equal(name, "2026-10-19 Squat sæt 2.mp4");
  assert.equal(cutFileName(name ?? ""), "2026-10-19 Squat sæt 2 klippet.mp4");
  assert.equal(cutFileName("2026-10-19 Squat sæt 2 klip 2.mp4"), "2026-10-19 Squat sæt 2 klip 2 klippet.mp4");
});

test("Gem with a cut: the cut's name and its actual range; busy reads Klipper", async () => {
  const p = await prepareClip(new Blob(["orig"]), "2026-10-19 Squat sæt 2.mp4", USER, async () => ({
    blob: new Blob(["cut"]),
    actual: { startS: 11.8, endS: 48 },
  }));
  assert.equal(saveDoneLine(p), "Sendt til Downloads som 2026-10-19 Squat sæt 2 klippet.mp4 · 11,8–48,0 s.");
  assert.equal(busyText(USER), "Klipper …");
  assert.equal(busyText({ reason: "none", range: null }), "Forbereder …");
});

test("a failed cut gives the original's bytes, no ' klippet', and §4's line", async () => {
  const orig = new Blob(["original bytes"]);
  const p = await prepareClip(orig, "2026-10-19 Squat sæt 2.mp4", USER, async () => {
    throw new Error("cut failed");
  });
  assert.equal(p.blob, orig);
  assert.equal(await p.blob.text(), "original bytes");
  assert.equal(p.name, "2026-10-19 Squat sæt 2.mp4");
  assert.equal(saveDoneLine(p), "Klippet lykkedes ikke. Sendt til Downloads som 2026-10-19 Squat sæt 2.mp4 (hele videoen).");
  assert.equal(shareCutLine(p), "Klippet lykkedes ikke. Delt hele videoen.");
});

test("Gem alle: 3 cut + 1 whole splits the count; all cut keeps clip-save's line", async () => {
  const clips: SaveClip[] = ["c1", "c2", "c3", "c4"].map((id) => ({ id, name: `${id}.mp4`, label: id }));
  async function run(cutIds: readonly string[]) {
    let cut = 0;
    const names: string[] = [];
    const r = await saveSequence(clips, {
      read: async () => new Blob(["x"]),
      download: (_b, name) => names.push(name),
      sleep: async () => {},
      onProgress: () => {},
      aborted: () => false,
      prepare: async (clip, blob) => {
        // c4 has a range but its cut fails: it counts as hele videoen
        const range: CutRange = cutIds.includes(clip.id) || clip.id === "c4" ? USER : { reason: "none", range: null };
        const p = await prepareClip(blob, clip.name, range, async (b) => {
          if (!cutIds.includes(clip.id)) throw new Error("fail");
          return { blob: b, actual: { startS: 12, endS: 48 } };
        });
        return { blob: p.blob, name: p.name, cut: p.kind === "cut" };
      },
      onSent: (c) => {
        if (c) cut += 1;
      },
    });
    return { line: doneLine(r, splitCount(r.sent, cut)), names };
  }
  const mixed = await run(["c1", "c2", "c3"]);
  assert.match(mixed.line, /^4 klip sendt til Downloads: 3 klippet, 1 hele videoen\. /);
  assert.deepEqual(mixed.names, ["c1 klippet.mp4", "c2 klippet.mp4", "c3 klippet.mp4", "c4.mp4"]);
  const all = await run(["c1", "c2", "c3", "c4"]);
  assert.match(all.line, /^4 klip sendt til Downloads\. /);
});

test("Kameratest keyframe line from given times: spacing, > 1,5 s warning, WebM, unmeasurable", () => {
  const ok = keyframeLines([0, 1, 2.05, 3, 4], "video/mp4;codecs=avc1");
  assert.equal(ok.line, "Nøglebilleder hvert 1,0 s (største afstand 1,05 s) · MP4 H.264");
  assert.equal(ok.warning, null);
  const gap = keyframeLines([0, 2.4, 3.4], "video/mp4;codecs=avc1");
  assert.equal(gap.warning, "◆ Et klip kan starte op til 2,4 s for tidligt.");
  assert.equal(keyframeLines(null, "video/webm;codecs=vp9").line, "◆ WebM kan ikke klippes. Gem og Del giver hele videoen.");
  assert.equal(keyframeLines([0], "video/mp4;codecs=avc1").line, "Afstanden kunne ikke måles.");
});
