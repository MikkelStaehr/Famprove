/**
 * The one analysis of a clip (slice clip-auto, design/specs/clip-auto.md): the model (fetched once
 * with a "model" phase when not cached), runPose, findLift, then setClipAuto with the run's wall time.
 * Fokus (after Stop) and Træning's pickup both call analyseClip, so the outcome is the same either
 * way. The pose runner, the model probe and the action are injected (auto-run-browser.ts binds the
 * real ones), so the outcomes, an abort and a failure are tested in node. Landmarks stay in memory:
 * only status, in/out and the run's ms are sent.
 */
import { type AutoClipResult, findLift, type LiftFamily, MAX_RUN_MS, type SetClipAutoInput, type SetClipAutoResult } from "./auto-clip.ts";
import type { ClipExt } from "./mime.ts";
import { PoseError, type PoseFailure, type PoseReached, type PoseResult } from "./pose-run.ts";

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
  | { readonly kind: "clipped"; readonly inS: number; readonly outS: number; readonly saved: boolean }
  | { readonly kind: "low_confidence"; readonly saved: boolean }
  | { readonly kind: "failed"; readonly saved: boolean; readonly error: AutoFailure }
  | { readonly kind: "aborted" }
  | { readonly kind: "skipped" };

export type AutoDeps = {
  /** Makes sure the model is in the HTTP cache: false when it already was (no model phase), true after a download. */
  readonly warmModel: (signal: AbortSignal, onPct: (pct: number | null) => void) => Promise<boolean>;
  readonly runPose: (blob: Blob, opts: { readonly signal: AbortSignal; readonly onProgress: (done: number, of: number) => void }) => Promise<PoseResult>;
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

/** Analyse one clip and store the outcome. Never throws; an abort (signal) writes nothing. */
export async function analyseClip(clipId: string, blob: Blob, meta: ClipMeta, opts: AnalyseOptions): Promise<AutoOutcome> {
  const { signal, deps } = opts;
  if (meta.ext !== "mp4") return { kind: "skipped" }; // WebM can't be cut (clip-cut §3): no analysis
  if (signal.aborted) return { kind: "aborted" };
  const started = deps.now();
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
    if (signal.aborted) return { kind: "aborted" };
    report({ kind: "running", pct: 0 });
    step = "pose";
    const pose = await deps.runPose(blob, { signal, onProgress: (done, of) => report({ kind: "running", pct: stepPct(done, of) }) });
    if (signal.aborted) return { kind: "aborted" };
    step = "lift";
    result = findLift(pose.frames, meta.expected, meta.family, meta.durationS);
  } catch (error) {
    if (signal.aborted) return { kind: "aborted" };
    result = null;
    failure = failureOf(step, error);
  }
  if (signal.aborted) return { kind: "aborted" };
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
  if (result === null) return { kind: "failed", saved, error: failure ?? { step, message: "ukendt", reached: null } };
  return result.status === "clipped" ? { kind: "clipped", inS: result.inS, outS: result.outS, saved } : { kind: "low_confidence", saved };
}
