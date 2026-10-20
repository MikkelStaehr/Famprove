/**
 * The one analysis of a clip (slice clip-auto, design/specs/clip-auto.md): the model (fetched once
 * with a "model" phase when not cached), runPose, findLift, then setClipAuto with the run's wall time.
 * Fokus (after Stop) and Træning's pickup both call analyseClip, so the outcome is the same either
 * way. The pose runner, the model probe and the action are injected (auto-run-browser.ts binds the
 * real ones), so the outcomes, an abort and a failure are tested in node. Landmarks stay in memory:
 * only status, in/out and the run's ms are sent.
 */
import { type AutoClipResult, findLift, type LiftFamily, type LowConfidenceReason, MAX_RUN_MS, type SetClipAutoInput, type SetClipAutoResult } from "./auto-clip.ts";
import type { ClipExt } from "./mime.ts";
import { type PoseMode, PoseError, type PoseFailure, type PoseReached, type PoseResult } from "./pose-run.ts";

/** The mode of a run and why, as the outcome and the debug log name it. */
export type ModeChoice = { readonly mode: PoseMode; readonly why: string; readonly keyframes?: string };

const comma1 = (v: number): string => v.toFixed(1).replace(".", ",");

/** The keyframe facts for the log (slice clip-auto-2): the largest gap, the last keyframe to the end included. Pure. */
export function keyframeFact(keyframes: readonly number[] | null, durationS: number): string {
  if (keyframes === null || keyframes.length === 0) return "nøglebilleder ukendt";
  const k = keyframes.toSorted((a, b) => a - b);
  let gap = k[0];
  for (let i = 1; i < k.length; i++) gap = Math.max(gap, k[i] - k[i - 1]);
  if (Number.isFinite(durationS) && durationS > 0) gap = Math.max(gap, durationS - k[k.length - 1]);
  return Number.isFinite(gap) ? `nøglebilleder op til ${comma1(gap)} s` : "nøglebilleder ukendt";
}

/**
 * The mode (slice clip-auto-3, the user's decision 2026-10-20): play (2×) always, since seek took
 * 73.6 s against play's 26.6 s on a 51.8 s phone clip; seek is only analyseClip's fallback after a
 * play "video" error. The keyframe facts stay for the log. Pure.
 */
export function chooseMode(keyframes: readonly number[] | null, durationS: number): ModeChoice {
  return { mode: "play", why: "afspil", keyframes: keyframeFact(keyframes, durationS) };
}

/** What the analysis needs of the clip besides its file: the format, its length, the lift's family and reps. */
export type ClipMeta = {
  readonly ext: ClipExt;
  readonly durationS: number;
  readonly family: LiftFamily;
  readonly expected: number | null;
};

/** §1's phases while a run is on: the model download (pct null without Content-Length), then the frames. */
export type AutoProgress = { readonly kind: "model"; readonly pct: number | null } | { readonly kind: "running"; readonly pct: number };

/**
 * Which step a failed run failed in (clip-debug): "model" (the model download), a runPose failure
 * (PoseError's reason: load, video, detect, timeout), "pose" (runPose threw something else) or
 * "lift" (findLift threw). Kept on the phone: setClipAuto still gets only "failed".
 */
export type FailStep = "model" | Exclude<PoseFailure, "aborted"> | "pose" | "lift";
export type AutoFailure = { readonly step: FailStep; readonly message: string; readonly reached: PoseReached | null };

/**
 * The run's outcome: clipped / low_confidence / failed were written (or tried: `saved`);
 * aborted and skipped (WebM) wrote nothing.
 */
export type AutoOutcome =
  | ({ readonly kind: "clipped"; readonly inS: number; readonly outS: number; readonly saved: boolean } & Ran)
  | ({ readonly kind: "low_confidence"; readonly saved: boolean; readonly reason: LowConfidenceReason } & Ran)
  | ({ readonly kind: "failed"; readonly saved: boolean; readonly error: AutoFailure } & Ran)
  | ({ readonly kind: "aborted"; readonly reason: string } & Ran)
  | { readonly kind: "skipped" };

/** The run's mode and why (null when it ended before choosing one) and its wall time (ms). */
type Ran = { readonly mode: ModeChoice | null; readonly runMs: number };

/** An abort's reason as words: the signal's reason or runPose's PoseError message. */
function abortReason(reason: unknown): string {
  return reason instanceof Error && reason.message !== "" && reason.name !== "AbortError" ? reason.message : "afbrudt";
}

export type AutoDeps = {
  /** The clip's keyframe times (s): cut.ts's mp4box parse; a throw counts as unknown. */
  readonly keyframeTimes: (blob: Blob) => Promise<number[]>;
  /** Makes sure the model is in the HTTP cache: false when it already was (no model phase), true after a download. */
  readonly warmModel: (signal: AbortSignal, onPct: (pct: number | null) => void) => Promise<boolean>;
  readonly runPose: (blob: Blob, opts: { readonly mode: PoseMode; readonly signal: AbortSignal; readonly onProgress: (done: number, of: number) => void }) => Promise<PoseResult>;
  readonly setClipAuto: (input: SetClipAutoInput) => Promise<SetClipAutoResult>;
  readonly now: () => number;
};

export type AnalyseOptions = {
  readonly signal: AbortSignal;
  readonly onProgress?: (p: AutoProgress) => void;
  readonly deps: AutoDeps;
};

/** Frames done ÷ frames as a % in steps of 10 (§1 line 3). */
export function stepPct(done: number, of: number): number {
  if (!(of > 0)) return 0;
  return Math.min(100, Math.floor((done / of) * 10) * 10);
}

/** A byte count as a % in steps of 10; null without a total (no Content-Length). */
export function bytePct(received: number, total: number | null): number | null {
  return total === null || !(total > 0) ? null : stepPct(received, total);
}

/** The failed step and its message: a PoseError names its own step (and how far it got). */
export function failureOf(step: "model" | "pose" | "lift", error: unknown): AutoFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (step === "pose" && error instanceof PoseError && error.reason !== "aborted") return { step: error.reason, message, reached: error.reached };
  return { step, message, reached: error instanceof PoseError ? error.reached : null };
}

/**
 * Analyse one clip and store the outcome. Never throws; an abort (the signal, or runPose's own
 * "aborted": a run whose page was hidden) writes nothing and says why. The mode comes from chooseMode
 * (play); a run that fails with a "video" PoseError is retried once in the other mode.
 */
export async function analyseClip(clipId: string, blob: Blob, meta: ClipMeta, opts: AnalyseOptions): Promise<AutoOutcome> {
  const { signal, deps } = opts;
  if (meta.ext !== "mp4") return { kind: "skipped" }; // WebM can't be cut (clip-cut §3): no analysis
  const started = deps.now();
  let choice: ModeChoice | null = null;
  const aborted = (reason: unknown): AutoOutcome => ({ kind: "aborted", reason: abortReason(reason), mode: choice, runMs: Math.max(0, Math.round(deps.now() - started)) });
  if (signal.aborted) return aborted(signal.reason);
  let lastPct: string | null = null;
  const report = (p: AutoProgress) => {
    const key = `${p.kind}:${p.pct}`;
    if (key === lastPct) return;
    lastPct = key;
    opts.onProgress?.(p);
  };
  let result: AutoClipResult | null = null;
  let failure: AutoFailure | null = null;
  let step: "model" | "pose" | "lift" = "model";
  try {
    await deps.warmModel(signal, (pct) => report({ kind: "model", pct }));
    if (signal.aborted) return aborted(signal.reason);
    let keyframes: number[] | null;
    try {
      keyframes = await deps.keyframeTimes(blob);
    } catch {
      keyframes = null; // unknown: play
    }
    if (signal.aborted) return aborted(signal.reason);
    choice = chooseMode(keyframes, meta.durationS);
    report({ kind: "running", pct: 0 });
    step = "pose";
    const run = (mode: PoseMode) => deps.runPose(blob, { mode, signal, onProgress: (done, of) => report({ kind: "running", pct: stepPct(done, of) }) });
    let pose: PoseResult;
    try {
      pose = await run(choice.mode);
    } catch (error) {
      if (signal.aborted || !(error instanceof PoseError) || error.reason !== "video") throw error;
      // One retry in the other mode: seek fails on far keyframes, play on a throttled element.
      choice = choice.mode === "seek" ? { mode: "play", why: "afspil: søgning fejlede", keyframes: choice.keyframes } : { mode: "seek", why: "søg: afspilning fejlede", keyframes: choice.keyframes };
      lastPct = null;
      report({ kind: "running", pct: 0 });
      pose = await run(choice.mode);
    }
    if (signal.aborted) return aborted(signal.reason);
    step = "lift";
    result = findLift(pose.frames, meta.expected, meta.family, meta.durationS);
  } catch (error) {
    if (signal.aborted) return aborted(signal.reason);
    if (error instanceof PoseError && error.reason === "aborted") return aborted(error);
    result = null;
    failure = failureOf(step, error);
  }
  if (signal.aborted) return aborted(signal.reason);
  const runMs = Math.min(MAX_RUN_MS, Math.max(0, Math.round(deps.now() - started)));
  const input: SetClipAutoInput =
    result === null
      ? { id: clipId, status: "failed", inS: null, outS: null, runMs }
      : result.status === "clipped"
        ? { id: clipId, status: "clipped", inS: result.inS, outS: result.outS, runMs }
        : { id: clipId, status: "low_confidence", inS: null, outS: null, runMs };
  let saved = false;
  try {
    saved = (await deps.setClipAuto(input)).ok;
  } catch {
    saved = false;
  }
  if (result === null) return { kind: "failed", saved, error: failure ?? { step, message: "ukendt", reached: null }, mode: choice, runMs };
  return result.status === "clipped"
    ? { kind: "clipped", inS: result.inS, outS: result.outS, saved, mode: choice, runMs }
    : { kind: "low_confidence", saved, reason: result.reason, mode: choice, runMs };
}
