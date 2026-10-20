/**
 * The debug panel's log (slice clip-debug): plain text for "Kopiér log", aggregates only (never a
 * landmark, a frame or a file name). Pure, so the wording is tested in node.
 */
import type { LiftDiagnosis, LiftFamily, SideVisibility } from "./auto-clip.ts";
import type { FileFacts } from "./cut.ts";
import type { PoseReached, SeekTiming } from "./pose-run.ts";

/** One run's log: runPose in seek or play mode (requestVideoFrameCallback), both as production runs them. */
export type DebugRun =
  | { readonly mode: "seek" | "play"; readonly ok: true; readonly diag: LiftDiagnosis; readonly seek: SeekTiming | null; readonly ms: number }
  | { readonly mode: "seek" | "play"; readonly ok: false; readonly step: string; readonly message: string; readonly reached: PoseReached | null; readonly ms: number };

/** A debug image's numbers: the person found and mean hip/knee visibility, from the video and from its canvas copy. */
export type FrameCheck = { readonly person: boolean; readonly hip: number | null; readonly knee: number | null };
export type ImageCheck = { readonly pct: number; readonly t: number; readonly video: FrameCheck; readonly canvas: FrameCheck };

export type DebugLogInput = {
  readonly clip: { readonly label: string; readonly status: string | null; readonly durationS: number | null; readonly family: LiftFamily | null; readonly expected: number | null };
  readonly facts: FileFacts | { readonly error: string } | null;
  readonly videoSize: { readonly w: number; readonly h: number } | null;
  readonly runs: readonly DebugRun[];
  readonly images: readonly ImageCheck[];
  readonly reanalyse: string | null;
};

const n2 = (v: number | null): string => (v === null || !Number.isFinite(v) ? "–" : v.toFixed(2));
const pct = (v: number | null): string => (v === null || !Number.isFinite(v) ? "–" : `${Math.round(v * 100)} %`);
const s1 = (v: number | null): string => (v === null || !Number.isFinite(v) ? "–" : `${v.toFixed(1)} s`);
const side = (name: string, v: SideVisibility): string => `${name} L ${n2(v.l)} R ${n2(v.r)}`;

function seekLine(s: SeekTiming): string {
  return `seek: ${s.count} · snit ${Math.round(s.meanMs)} ms · max ${Math.round(s.maxMs)} ms (billede ${s.maxAt ?? "–"})`;
}

function runLines(r: DebugRun): string[] {
  const head = `[${r.mode === "seek" ? "søg" : "afspil"}] ${Math.round(r.ms)} ms`;
  if (!r.ok) {
    const out = [head, `fejlede i trin: ${r.step}`, `fejl: ${r.message}`];
    if (r.reached !== null) out.push(`nåede billede ${r.reached.done} af ${r.reached.of}`, seekLine(r.reached.seek));
    return out;
  }
  const d = r.diag;
  const t = d.trace;
  const verdict = d.result.status === "clipped" ? `clipped ${d.result.inS}–${d.result.outS} s (${d.result.reps} reps)` : `low_confidence: ${d.result.reason}`;
  const out = [
    head,
    `billeder: ${d.frames} · person fundet: ${pct(d.personShare)}`,
    side("hofte", d.visibility.hips),
    side("knæ", d.visibility.knees),
    side("skulder", d.visibility.shoulders),
    `led: ${t.joint ?? "–"} · gyldige: ${pct(t.validShare)}`,
    `udsving p5–p95: ${pct(t.range)} af billedhøjden`,
    `toppe: op ${t.peaksUp ?? "–"} · ned ${t.peaksDown ?? "–"} · valgt ${t.chosenSign === null ? "–" : t.chosenSign === 1 ? "op" : "ned"} · forventet ${d.expected ?? "–"}`,
    `rep-længder: ${t.repLengths === null ? "–" : t.repLengths.map((l) => l.toFixed(1)).join(" · ") + " s"}`,
    `resultat: ${verdict}`,
  ];
  if (r.seek !== null) out.push(seekLine(r.seek));
  return out;
}

const check = (c: FrameCheck): string => `${c.person ? "person ja" : "person nej"} · hofte ${n2(c.hip)} · knæ ${n2(c.knee)}`;

/** The whole log, one fact per line. */
export function debugLog(input: DebugLogInput): string {
  const c = input.clip;
  const lines = [`klip: ${c.label} · status ${c.status ?? "ingen"} · længde ${s1(c.durationS)} · ${c.family ?? "–"} · forventet ${c.expected ?? "–"} reps`];
  if (input.facts !== null) {
    if ("error" in input.facts) lines.push(`fil: kunne ikke læses (${input.facts.error})`);
    else {
      const f = input.facts;
      lines.push(
        `fil: rotation ${f.rotation === null ? "ukendt" : `${f.rotation}°`} · kodet ${f.codedWidth}×${f.codedHeight} · ${s1(f.durationS)}`,
        `keyframes: ${f.keyframes} · største afstand ${s1(f.maxKeyframeGapS)}`,
      );
    }
  }
  if (input.videoSize !== null) lines.push(`<video>: ${input.videoSize.w}×${input.videoSize.h}`);
  for (const r of input.runs) lines.push(...runLines(r));
  for (const im of input.images) lines.push(`billede ${im.pct} % (${s1(im.t)}): video ${check(im.video)} | canvas ${check(im.canvas)}`);
  if (input.reanalyse !== null) lines.push(`analysér igen: ${input.reanalyse}`);
  return lines.join("\n");
}

/** A frame's check from its landmarks (null = no person): mean visibility of both hips (23/24) and both knees (25/26). */
export function frameCheck(points: readonly (readonly [number, number, number])[] | null): FrameCheck {
  if (points === null) return { person: false, hip: null, knee: null };
  const mean = (a: number, b: number): number | null => {
    const v = [points[a]?.[2], points[b]?.[2]].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length === 0 ? null : v.reduce((s, x) => s + x, 0) / v.length;
  };
  return { person: true, hip: mean(23, 24), knee: mean(25, 26) };
}

/** Shift+D toggles the hidden panel, never while the focus is in a field the user types into. */
export function isDebugToggle(
  e: { readonly key: string; readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean },
  target: { readonly tagName?: string; readonly isContentEditable?: boolean } | null,
): boolean {
  if (e.key !== "D" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (target === null) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && target.isContentEditable !== true;
}

/** Stopping the panel revokes every blob URL it made and leaves no images pointing at one. */
export function releaseImages<T>(urls: readonly string[], revoke: (url: string) => void): { readonly urls: string[]; readonly images: readonly T[] } {
  for (const u of urls) revoke(u);
  return { urls: [], images: [] };
}
