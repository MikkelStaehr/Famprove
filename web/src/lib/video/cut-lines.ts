/**
 * The cut's lines (slice clip-cut, design/specs/clip-cut.md): one number format for every line, the
 * player's cut line, Gem's and Del's done lines, Gem alle's split and Kameratest's keyframe lines.
 * Pure: the cut itself is injected (prepareClip), so a failing cut is tested with a fake.
 */
import type { CutRange } from "./cut.ts";

/** Seconds with one decimal and a decimal comma: `12,3 s`; from 60 s `m:ss,d` (`1:02,3`). */
export function formatSeconds(s: number): string {
  const tenths = Math.round(s * 10);
  if (tenths < 600) return `${(tenths / 10).toFixed(1).replace(".", ",")} s`;
  return clock(tenths);
}

function clock(tenths: number): string {
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const sec = (rest / 10).toFixed(1).replace(".", ",");
  return `${m}:${sec.padStart(4, "0")}`;
}

/** A range with an en dash and no spaces: `12,3–48,0 s`; from 60 s both ends `m:ss,d`. */
export function formatRange(a: number, b: number): string {
  const ta = Math.round(a * 10);
  const tb = Math.round(b * 10);
  if (tb < 600) return `${(ta / 10).toFixed(1).replace(".", ",")}–${(tb / 10).toFixed(1).replace(".", ",")} s`;
  return `${clock(ta)}–${clock(tb)}`;
}

/** §3: a WebM clip can't be cut. */
export const WEBM_LINE = "Kan ikke klippes på denne telefon. Gem og Del giver hele videoen.";

/** §1: the player's line under the title row (the in/out as set); null = no line. WebM: §3's line. */
export function cutLine(cut: CutRange): string | null {
  if (cut.reason === "webm") return WEBM_LINE;
  if (cut.range === null) return null;
  const { inS, outS } = cut.range;
  return `Klippet ${formatRange(inS, outS)} · ${formatSeconds(outS - inS)}${cut.reason === "auto" ? " · automatisk" : ""}`;
}

/** §2: clip-save's name with ` klippet` before the extension. A whole file never gets the word. */
export function cutFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? `${name} klippet` : `${name.slice(0, dot)} klippet${name.slice(dot)}`;
}

/** The cut file's actual start and end in the original (s): the start may be up to a keyframe gap early. */
export type ActualRange = { readonly startS: number; readonly endS: number };

export type CutFn = (blob: Blob, inS: number, outS: number) => Promise<{ readonly blob: Blob; readonly actual: ActualRange }>;

export type Prepared =
  | { readonly kind: "whole"; readonly blob: Blob; readonly name: string }
  | { readonly kind: "cut"; readonly blob: Blob; readonly name: string; readonly actual: ActualRange }
  | { readonly kind: "failed"; readonly blob: Blob; readonly name: string };

/** The file Gem / Del hand over: the cut when the clip has a range, else (or when the cut throws) the original, whole. */
export async function prepareClip(blob: Blob, name: string, cut: CutRange, cutFn: CutFn): Promise<Prepared> {
  if (cut.range === null) return { kind: "whole", blob, name };
  try {
    const r = await cutFn(blob, cut.range.inS, cut.range.outS);
    return { kind: "cut", blob: r.blob, name: cutFileName(name), actual: r.actual };
  } catch {
    return { kind: "failed", blob, name };
  }
}

/** §2 / §4: Gem's done line. */
export function saveDoneLine(p: Prepared): string {
  if (p.kind === "cut") return `Sendt til Downloads som ${p.name} · ${formatRange(p.actual.startS, p.actual.endS)}.`;
  if (p.kind === "failed") return `Klippet lykkedes ikke. Sendt til Downloads som ${p.name} (hele videoen).`;
  return `Sendt til Downloads som ${p.name}.`;
}

/** §4: Del's line after a failed cut that was shared whole; else null (Del has no done line). */
export function shareCutLine(p: Prepared): string | null {
  return p.kind === "failed" ? "Klippet lykkedes ikke. Delt hele videoen." : null;
}

/** §7: Gem's and Del's busy text. */
export function busyText(cut: CutRange): string {
  return cut.range === null ? "Forbereder …" : "Klipper …";
}

/** §5: Gem alle's count sentence, split only when the clips sent were not all cut the same way. */
export function splitCount(sent: number, cut: number): string | null {
  if (cut === 0 || cut === sent) return null;
  return `${sent} klip sendt til Downloads: ${cut} klippet, ${sent - cut} hele videoen.`;
}

/** §6: the recorder's mime type in plain words. */
export function formatName(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.startsWith("video/mp4")) return "MP4 H.264";
  if (m.includes("vp9")) return "WebM VP9";
  if (m.includes("vp8")) return "WebM VP8";
  return m.startsWith("video/webm") ? "WebM" : mimeType;
}

export type KeyframeLines = { readonly line: string; readonly warning: string | null };

/** The warning threshold for the largest keyframe gap (s). */
export const GAP_WARN_S = 1.5;

function comma(x: number, digits: number): string {
  return x.toFixed(digits).replace(".", ",");
}

/**
 * §6: Kameratest's line(s) from the test clip's keyframe times (s) and the recorder's mime type.
 * WebM: the one warning; fewer than two keyframes: "Afstanden kunne ikke måles."
 */
export function keyframeLines(times: readonly number[] | null, mimeType: string): KeyframeLines {
  if (mimeType.toLowerCase().startsWith("video/webm")) return { line: "◆ WebM kan ikke klippes. Gem og Del giver hele videoen.", warning: null };
  if (times === null || times.length < 2) return { line: "Afstanden kunne ikke måles.", warning: null };
  const sorted = [...times].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - (sorted[i] as number));
  const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  const largest = Math.max(...gaps);
  const line = `Nøglebilleder hvert ${comma(mean, 1)} s (største afstand ${comma(largest, 2)} s) · ${formatName(mimeType)}`;
  const warning = largest > GAP_WARN_S ? `◆ Et klip kan starte op til ${comma(largest, 1)} s for tidligt.` : null;
  return { line, warning };
}
