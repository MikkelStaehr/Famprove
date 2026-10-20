/**
 * The cut (slice clip-cut, user 2026-10-20): a clip's [in, out) as a plain MP4, without
 * re-encoding. Chrome's MediaRecorder writes a fragmented MP4 (ftyp, moov, moof+mdat pairs, mfra)
 * without B-frames; mp4box.js (the user's choice) reads it, and the output is one ftyp + moov
 * (no mvex) + one mdat. mp4box's own writer always writes fragments, so the sample tables are
 * filled here (stts, stss, stsz, stsc, stco). Video track only: the recorder records no audio.
 *
 * mp4box is loaded by a dynamic import() inside the cut, never in the initial bundle.
 *
 * Memory: the file is fed to mp4box in CHUNK-byte slices with keepMdatData = false, so the parse
 * holds one chunk plus the boxes, never the whole clip. The output is a Blob of the new header and
 * slices of the original Blob, so the sample bytes are never copied into JS memory.
 */

import type { VideoClipRow } from "./clips.ts";
import type { ClipExt } from "./mime.ts";

/** Why a cut can't be made; the caller then gives the original file. */
export type CutFailure = "not_mp4" | "truncated" | "codec" | "empty_range";

export class CutError extends Error {
  readonly reason: CutFailure;
  constructor(reason: CutFailure, message: string) {
    super(message);
    this.name = "CutError";
    this.reason = reason;
  }
}

/** The bytes fed to mp4box per step (bounds the parse's memory). */
export const CHUNK = 1024 * 1024;

/** One video sample as the cut needs it: times in the track's timescale, place in the file. */
type CutSample = {
  readonly offset: number;
  readonly size: number;
  readonly dts: number;
  readonly cts: number;
  readonly duration: number;
  readonly sync: boolean;
};

type Parsed = {
  readonly mp4: typeof import("mp4box");
  readonly timescale: number;
  readonly width: number;
  readonly height: number;
  readonly avcC: ArrayBuffer;
  readonly samples: readonly CutSample[];
  /** The tkhd matrix (9 values, a b u c d v x y w; a–d in 16.16 fixed point). */
  readonly matrix: readonly number[];
};

async function parse(file: Blob): Promise<Parsed> {
  const mp4 = await import("mp4box");
  const f = mp4.createFile(false); // keepMdatData = false: sample bytes are not kept
  let ready = false;
  let parseError: string | null = null;
  f.onReady = () => {
    ready = true;
  };
  f.onError = (_module: string, message: string) => {
    parseError = message;
  };
  try {
    for (let p = 0; p < file.size; p += CHUNK) {
      const ab = await file.slice(p, Math.min(file.size, p + CHUNK)).arrayBuffer();
      f.appendBuffer(mp4.MP4BoxBuffer.fromArrayBuffer(ab, p));
    }
    f.flush();
  } catch (error) {
    throw new CutError("not_mp4", `mp4box could not read the file: ${String(error)}`);
  }
  const info = ready ? f.getInfo() : null;
  const track = info?.videoTracks[0];
  if (parseError !== null || info === null || track === undefined) {
    throw new CutError("not_mp4", parseError ?? "no video track (not an MP4, or no moov)");
  }
  const trak = f.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const avcCBox = entry !== undefined && "avcC" in entry ? (entry as { avcC?: { write(s: InstanceType<typeof mp4.DataStream>): void } }).avcC : undefined; // avc1/avc3 sample entry
  if (avcCBox === undefined) throw new CutError("codec", `not H.264 (${track.codec})`);
  const ds = new mp4.DataStream(undefined, 0, mp4.Endianness.BIG_ENDIAN);
  avcCBox.write(ds);
  const avcC = ds.buffer.slice(8); // without the box header
  const samples: CutSample[] = trak.samples.map((s) => ({ offset: s.offset, size: s.size, dts: s.dts, cts: s.cts, duration: s.duration, sync: s.is_sync }));
  if (samples.length === 0) throw new CutError("truncated", "no samples");
  for (const s of samples) {
    if (!(s.size > 0) || s.offset + s.size > file.size) throw new CutError("truncated", `sample at ${s.offset} (+${s.size}) runs past the file's ${file.size} bytes`);
  }
  return { mp4, timescale: track.timescale, width: track.video?.width ?? 0, height: track.video?.height ?? 0, avcC, samples, matrix: Array.from(track.matrix) };
}

/** The keyframes' start times in seconds (Kameratest measures their spacing). */
export async function keyframeTimes(file: Blob): Promise<number[]> {
  const p = await parse(file);
  return p.samples.filter((s) => s.sync).map((s) => s.cts / p.timescale);
}

/**
 * The display rotation a tkhd matrix asks for, clockwise in degrees (0/90/180/270), or null when it
 * is no quarter turn. a = m[0] = cos θ, b = m[1] = sin θ (16.16 fixed point; the scale cancels).
 */
export function matrixRotation(m: readonly number[]): 0 | 90 | 180 | 270 | null {
  const a = m[0];
  const b = m[1];
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  const deg = (Math.round((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360;
  return deg === 0 || deg === 90 || deg === 180 || deg === 270 ? deg : null;
}

/** A clip file's facts for the debug panel (clip-debug): rotation, coded size and keyframes. */
export type FileFacts = {
  readonly rotation: 0 | 90 | 180 | 270 | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly keyframes: number;
  /** The largest gap between keyframes (s), the last one to the end included; null with no keyframe. */
  readonly maxKeyframeGapS: number | null;
  readonly durationS: number;
};

/** The file's facts from the same parse the cut uses (no second parser). */
export async function fileFacts(file: Blob): Promise<FileFacts> {
  const p = await parse(file);
  const kf = p.samples.filter((s) => s.sync).map((s) => s.cts / p.timescale);
  const last = p.samples[p.samples.length - 1];
  const durationS = (last.cts + last.duration) / p.timescale;
  let gap: number | null = null;
  for (let i = 0; i < kf.length; i++) {
    const next = i + 1 < kf.length ? kf[i + 1] : durationS;
    gap = Math.max(gap ?? 0, next - kf[i]);
  }
  return { rotation: matrixRotation(p.matrix), codedWidth: p.width, codedHeight: p.height, keyframes: kf.length, maxKeyframeGapS: gap, durationS };
}

/** Run-length pairs (counts, values) for stts. */
function rle(values: readonly number[]): [number[], number[]] {
  const counts: number[] = [];
  const out: number[] = [];
  for (const v of values) {
    if (out.length > 0 && out[out.length - 1] === v) counts[counts.length - 1]++;
    else {
      counts.push(1);
      out.push(v);
    }
  }
  return [counts, out];
}

/** Which samples a cut keeps: from the keyframe at or before inS to the last sample starting before outS. */
export function keptRange(samples: readonly CutSample[], timescale: number, inS: number, outS: number): { first: number; end: number } {
  const last = samples[samples.length - 1];
  const endS = last === undefined ? 0 : (last.cts + last.duration) / timescale;
  if (!(Number.isFinite(inS) && Number.isFinite(outS) && inS >= 0 && inS < outS && inS < endS)) {
    throw new CutError("empty_range", `range ${inS}–${outS} s is empty for a ${endS.toFixed(3)} s clip`);
  }
  const inT = inS * timescale;
  const outT = outS * timescale;
  let first = -1;
  for (let i = 0; i < samples.length; i++) if (samples[i].sync && samples[i].cts <= inT) first = i;
  if (first < 0) throw new CutError("empty_range", "no keyframe at or before the in point");
  let end = first;
  while (end < samples.length && samples[end].cts < outT) end++;
  if (end === first) throw new CutError("empty_range", "no sample starts before the out point");
  return { first, end };
}

/**
 * The clip from the keyframe at or before inS to the last sample whose start is before outS,
 * rebased to 0, as a plain MP4. Throws CutError (not an MP4, unreadable or truncated, not H.264,
 * empty range); the caller then gives the original.
 */
export async function cutMp4(file: Blob, inS: number, outS: number): Promise<Blob> {
  return (await cutClip(file, inS, outS)).blob;
}

/** cutMp4 plus the cut's actual start and end in the original (s), for Gem's done line (clip-cut §2). */
export async function cutClip(file: Blob, inS: number, outS: number): Promise<{ blob: Blob; actual: { startS: number; endS: number } }> {
  const { mp4, timescale, width, height, avcC, samples } = await parse(file);
  const { first, end } = keptRange(samples, timescale, inS, outS);
  const kept = samples.slice(first, end);
  const base = kept[0].dts;
  const total = kept.reduce((a, s) => a + s.duration, 0);

  const out = mp4.createFile();
  const id = out.addTrack({
    timescale,
    duration: total,
    media_duration: total,
    width,
    height,
    avcDecoderConfigRecord: avcC,
    brands: ["isom", "iso2", "avc1", "mp41"],
    name: "VideoHandler",
  });
  const moov = out.moov;
  const ftyp = out.ftyp;
  if (moov === undefined || ftyp === undefined) throw new CutError("codec", "mp4box made no moov");
  moov.boxes = (moov.boxes ?? []).filter((b) => b.type !== "mvex"); // plain MP4: no fragments
  moov.mvex = undefined;
  moov.mvhd.duration = total;
  const trak = out.getTrackById(id);
  trak.tkhd.duration = total;
  const stbl = trak.mdia.minf.stbl;
  [stbl.stts.sample_counts, stbl.stts.sample_deltas] = rle(kept.map((s) => s.duration));
  if (kept.some((s) => s.cts - base !== s.dts - base)) throw new CutError("codec", "B-frames (cts ≠ dts) are not supported");
  if (kept.some((s) => !s.sync)) {
    const stss = stbl.addBox(new mp4.BoxParser.box.stss());
    stss.sample_numbers = kept.flatMap((s, i) => (s.sync ? [i + 1] : []));
  }
  stbl.stsz.sample_size = 0;
  stbl.stsz.sample_sizes = kept.map((s) => s.size);
  stbl.stsc.first_chunk = [1];
  stbl.stsc.samples_per_chunk = [kept.length];
  stbl.stsc.sample_description_index = [1];

  const header = (): Uint8Array<ArrayBuffer> => {
    const ds = new mp4.DataStream(undefined, 0, mp4.Endianness.BIG_ENDIAN);
    ftyp.write(ds);
    moov.write(ds);
    return new Uint8Array(ds.buffer);
  };
  stbl.stco.chunk_offsets = [0];
  const headLength = header().length; // stco's value doesn't change the header's length
  stbl.stco.chunk_offsets = [headLength + 8]; // the one chunk starts right after mdat's header
  const head = header();

  const payload = kept.reduce((a, s) => a + s.size, 0);
  // mdat's size and stco's offset are 32-bit: a cut must stay under 4 GB. A clip is at most 900 s
  // (≈ 280 MB at the recorder's rate), so this only guards a file the app didn't record.
  if (headLength + 8 + payload > 0xffffffff) throw new CutError("truncated", "the cut would be over 4 GB (32-bit mdat)");
  const mdat = new Uint8Array(8);
  new DataView(mdat.buffer).setUint32(0, 8 + payload);
  mdat.set([0x6d, 0x64, 0x61, 0x74], 4); // "mdat"

  // Slices of the original, one per run of adjacent samples (each fragment's mdat is one run).
  const parts: Blob[] = [];
  let runStart = kept[0].offset;
  let runEnd = runStart;
  for (const s of kept) {
    if (s.offset !== runEnd) {
      parts.push(file.slice(runStart, runEnd));
      runStart = s.offset;
    }
    runEnd = s.offset + s.size;
  }
  parts.push(file.slice(runStart, runEnd));
  const lastKept = kept[kept.length - 1] as CutSample;
  const actual = { startS: kept[0].cts / timescale, endS: (lastKept.cts + lastKept.duration) / timescale };
  return { blob: new Blob([head, mdat, ...parts], { type: "video/mp4" }), actual };
}

/** Where a clip's cut comes from: the user's points, the automatic ones, none, or none because WebM. */
export type CutReason = "user" | "auto" | "none" | "webm";

export type CutRange = { readonly reason: CutReason; readonly range: { readonly inS: number; readonly outS: number } | null };

/** clip-auto-park: `auto: false` ignores the auto_* range (the switch is off); default true = as before. */
export type CutOptions = { readonly auto?: boolean };

/**
 * The range to cut a stored clip to: the user's clip_in_s/clip_out_s win, then auto_in_s/auto_out_s
 * when auto_status is 'clipped' (low_confidence, failed and not-yet-run give none), else none.
 * A WebM clip is never cut (mp4box reads MP4 only). Pure.
 */
export function cutRange(row: Pick<VideoClipRow, "clipInS" | "clipOutS" | "autoInS" | "autoOutS" | "autoStatus">, ext: ClipExt, opts: CutOptions = {}): CutRange {
  if (ext === "webm") return { reason: "webm", range: null };
  const valid = (a: number | null, b: number | null): a is number => a !== null && b !== null && a >= 0 && a < b;
  if (valid(row.clipInS, row.clipOutS)) return { reason: "user", range: { inS: row.clipInS, outS: row.clipOutS as number } };
  if (opts.auto !== false && row.autoStatus === "clipped" && valid(row.autoInS, row.autoOutS)) return { reason: "auto", range: { inS: row.autoInS, outS: row.autoOutS as number } };
  return { reason: "none", range: null };
}
