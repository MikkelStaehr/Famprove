import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  clipFileNames,
  DOWNLOAD_GAP_MS,
  doneLine,
  type NameRow,
  REVOKE_AFTER_MS,
  safeNamePart,
  type SaveClip,
  saveSequence,
  todaysClips,
  urlKeeper,
} from "../src/lib/video/save.ts";

const ID = "00000000-0000-4000-8000-000000000001";

function row(p: Partial<NameRow> & { id: string }): NameRow {
  return { kind: "clip", ext: "mp4", exercise: "Squat", variant: null, date: "2026-10-19", set: 2, recordedAt: "2026-10-19T10:00:00+02:00", ...p };
}

test("name: date, shown name, sæt n, ext; no uuid", () => {
  const n = clipFileNames([row({ id: ID })]).get(ID);
  assert.equal(n, "2026-10-19 Squat sæt 2.mp4");
  assert.ok(!n?.includes(ID));
});

test("name: the variant's display name wins; .webm; afbrudt", () => {
  const names = clipFileNames([row({ id: "a", variant: "Tempo squat", set: 1, ext: "webm", kind: "afbrudt" })]);
  assert.equal(names.get("a"), "2026-10-19 Tempo squat sæt 1 afbrudt.webm");
});

test("name: two clips of one set get klip 1 / klip 2 by recordedAt, the same from all rows", () => {
  const a = row({ id: "b", recordedAt: "2026-10-19T10:05:00+02:00" });
  const b = row({ id: "a", recordedAt: "2026-10-19T10:01:00+02:00" });
  const other = row({ id: "c", set: 3 });
  const all = clipFileNames([a, b, other, row({ id: "m", kind: "missing", ext: null })]);
  assert.equal(all.get("a"), "2026-10-19 Squat sæt 2 klip 1.mp4");
  assert.equal(all.get("b"), "2026-10-19 Squat sæt 2 klip 2.mp4");
  assert.equal(all.get("c"), "2026-10-19 Squat sæt 3.mp4");
  assert.equal(all.has("m"), false);
  assert.equal(clipFileNames([b, a]).get("b"), all.get("b"));
});

test("name: unsafe characters become -, æøå kept, the name part ≤ 60", () => {
  assert.equal(clipFileNames([row({ id: "x", exercise: "Squat / pause" })]).get("x"), "2026-10-19 Squat - pause sæt 2.mp4");
  assert.equal(clipFileNames([row({ id: "x", exercise: "Bænkpres  på   skrå" })]).get("x"), "2026-10-19 Bænkpres på skrå sæt 2.mp4");
  const long = clipFileNames([row({ id: "x", exercise: "a".repeat(90) })]).get("x") ?? "";
  const part = long.slice("2026-10-19 ".length, long.indexOf(" sæt "));
  assert.equal(part.length, 60);
});

test("todaysClips: today's clip and afbrudt rows only, oldest first", () => {
  const rows = [
    row({ id: "2", recordedAt: "2026-10-19T10:09:00+02:00" }),
    row({ id: "1", recordedAt: "2026-10-19T10:01:00+02:00", kind: "afbrudt" }),
    row({ id: "m", kind: "missing", ext: null }),
    row({ id: "r", kind: "remote", ext: null }),
    row({ id: "y", date: "2026-10-18" }),
  ];
  assert.deepEqual(todaysClips(rows, "2026-10-19").map((r) => r.id), ["1", "2"]);
});

/** A fake clock: timers fire as time advances; sleep advances it. */
function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return {
    now: () => now,
    advance,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        seq += 1;
        timers.set(seq, { at: now + ms, fn });
        return seq;
      },
      clearTimeout: (h: unknown) => void timers.delete(h as number),
    },
    sleep: async (ms: number) => advance(ms),
  };
}

function setup(missing: ReadonlySet<string> = new Set(), unreadable: ReadonlySet<string> = new Set()) {
  const c = clock();
  const revoked: { url: string; at: number }[] = [];
  const keeper = urlKeeper((url) => revoked.push({ url, at: c.now() }), c.timers);
  const downloads: { name: string; at: number; url: string }[] = [];
  const progress: number[] = [];
  let stopAfter = Infinity;
  const deps = {
    read: async (id: string) => {
      if (unreadable.has(id)) throw new Error("storage");
      return missing.has(id) ? null : new Blob([id]);
    },
    download: (_: Blob, name: string) => {
      const url = `blob:${name}`;
      downloads.push({ name, at: c.now(), url });
      keeper.add(url);
    },
    sleep: c.sleep,
    onProgress: (k: number) => progress.push(k),
    aborted: () => progress.length >= stopAfter,
  };
  return { c, keeper, revoked, downloads, progress, deps, stopAt: (n: number) => (stopAfter = n) };
}

const CLIPS: SaveClip[] = [1, 2, 3, 4].map((n) => ({ id: `c${n}`, name: `2026-10-19 Squat sæt ${n}.mp4`, label: `Squat sæt ${n}` }));

test("sequence: 4 clips → 4 downloads oldest first, ≥ 400 ms apart, progress 1..4, each URL revoked once at 60 s", async () => {
  const s = setup();
  const r = await saveSequence(CLIPS, s.deps);
  assert.equal(r.sent, 4);
  assert.deepEqual(s.downloads.map((d) => d.name), CLIPS.map((c) => c.name));
  for (let i = 1; i < s.downloads.length; i++) assert.ok((s.downloads[i]?.at ?? 0) - (s.downloads[i - 1]?.at ?? 0) >= DOWNLOAD_GAP_MS);
  assert.deepEqual(s.progress, [1, 2, 3, 4]);
  assert.equal(s.revoked.length, 0); // never on the click
  s.c.advance(REVOKE_AFTER_MS * 2);
  assert.deepEqual(s.revoked.map((x) => x.url).sort(), s.downloads.map((d) => d.url).sort());
  for (const d of s.downloads) assert.equal(s.revoked.find((x) => x.url === d.url)?.at, d.at + REVOKE_AFTER_MS);
  s.keeper.revokeAll();
  assert.equal(s.revoked.length, 4); // exactly once
  assert.match(doneLine(r), /^4 klip sendt til Downloads\. Mangler nogle/);
});

test("sequence: a missing file is skipped and named, the others still download; an unreadable one is named apart", async () => {
  const s = setup(new Set(["c2"]), new Set(["c3"]));
  const r = await saveSequence(CLIPS, s.deps);
  assert.equal(r.sent, 2);
  assert.deepEqual(s.downloads.map((d) => d.name), [CLIPS[0]?.name, CLIPS[3]?.name]);
  assert.deepEqual(r.missing.map((c) => c.id), ["c2"]);
  assert.match(doneLine(r), /1 fil mangler på telefonen: Squat sæt 2\./);
  assert.match(doneLine(r), /1 fil kunne ikke læses: Squat sæt 3\./);
  const many = doneLine({ ...r, missing: CLIPS.concat(CLIPS.slice(0, 1)) });
  assert.match(many, /5 filer mangler på telefonen: Squat sæt 1, Squat sæt 2, Squat sæt 3 og 2 til\./);
});

test("sequence: abort after clip 2 → 2 remaining, Stoppet ved 2 af 4; resume saves the rest; abort revokes every open URL once", async () => {
  const s = setup();
  s.stopAt(2);
  const r = await saveSequence(CLIPS, s.deps);
  assert.equal(r.sent, 2);
  assert.deepEqual(r.remaining.map((c) => c.id), ["c3", "c4"]);
  assert.equal(doneLine(r), "Stoppet ved 2 af 4.");
  s.keeper.revokeAll(); // pagehide / unmount
  assert.equal(s.revoked.length, 2);
  s.c.advance(REVOKE_AFTER_MS * 2);
  assert.equal(s.revoked.length, 2); // the timers never revoke again
  s.stopAt(Infinity);
  const rest = await saveSequence(r.remaining, s.deps);
  assert.equal(rest.sent, 2);
  assert.deepEqual(s.downloads.map((d) => d.name), CLIPS.map((c) => c.name)); // nothing twice
});

test("a single clip skips the prompt sentence", () => {
  assert.equal(doneLine({ sent: 1, missing: [], unreadable: [], remaining: [], total: 1 }), "1 klip sendt til Downloads.");
});

test("save.ts imports nothing from actions and makes no request", () => {
  const src = readFileSync(new URL("../src/lib/video/save.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from ["'][^"']*actions/);
  assert.doesNotMatch(src, /\bfetch\(/);
});

test("name: bidi and invisible characters are dropped, C1 controls become - (security, 2026-10-20)", () => {
  assert.equal(safeNamePart("Squat\u202egnp.exe"), "Squatgnp.exe");
  assert.equal(safeNamePart("\ufeffBench\u200b\u2066 press\u2069\u200f"), "Bench press");
  assert.equal(safeNamePart("Dead\u0085lift"), "Dead-lift");
  const n = clipFileNames([row({ id: ID, exercise: "Squat\u202e4pm" })]).get(ID);
  assert.equal(n, "2026-10-19 Squat4pm sæt 2.mp4");
});

test("sequence: a stopped run still names the files that were missing (review 2026-10-20)", () => {
  const missing: SaveClip = { id: "m", name: "x.mp4", label: "Squat sæt 1" };
  const line = doneLine({ sent: 1, missing: [missing], unreadable: [], remaining: [missing], total: 4 });
  assert.match(line, /^Stoppet ved 3 af 4\. 1 fil mangler på telefonen: Squat sæt 1\.$/);
});
