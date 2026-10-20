/**
 * MediaPipe Pose lite on the phone (slice clip-pose): the risk check before clip-auto. Self-hosted:
 * the WASM is copied to /mediapipe/<version>/wasm by scripts/copy-mediapipe.mjs and the model is
 * committed under /mediapipe/models/<name>/<precision>/<version>/ (its source URL's path), so the
 * WASM and the model load from this origin (no CDN default path). Not every request stays here:
 * MediaPipe 1.1.0 has a built-in usage logger that can't be turned off; on close() and every 60 s it
 * POSTs OS family, version, task and latency (no frames, no landmarks) to
 * https://odml.pa.googleapis.com/v1/log. The CSP's connect-src 'self' blocks it (next.config.ts);
 * never loosen connect-src. The package is loaded only by dynamic import(), never in the initial
 * bundle. Landmarks stay in memory; this code stores and sends nothing.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";

/** The installed @mediapipe/tasks-vision version (a test holds it equal to package.json). */
export const MEDIAPIPE_VERSION = "1.1.0";
export const WASM_BASE = `/mediapipe/${MEDIAPIPE_VERSION}/wasm`;
/** Versioned like its source, storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/. */
export const MODEL_PATH = "/mediapipe/models/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
/** The wall-time cap of one run, load included. */
export const POSE_CAP_MS = 90_000;

/** One landmark: normalised x, y and visibility (0–1). */
export type PosePoint = readonly [x: number, y: number, visibility: number];
/** One sampled frame: its time in the clip (s) and the 33 landmarks of one person, or null when none was found. */
export type PoseFrame = { readonly t: number; readonly landmarks: readonly PosePoint[] | null };
/** loadMs: WASM + model; totalMs: the frame pass (seeks + detection); msPerFrame: mean detection time. */
export type PoseTiming = { readonly loadMs: number; readonly frames: number; readonly msPerFrame: number; readonly totalMs: number };
/** Per-seek wall time (slice clip-debug): count, mean and max (ms), and the frame index of the max (null with no seek). */
export type SeekTiming = { readonly count: number; readonly meanMs: number; readonly maxMs: number; readonly maxAt: number | null };
export type PoseResult = { readonly frames: readonly PoseFrame[]; readonly timing: PoseTiming };
/** runPose's result: PoseResult plus clip-debug's seek timing (a sibling type, so PoseResult keeps its meaning). */
export type PoseRun = PoseResult & { readonly seek: SeekTiming };

/** How far a failed run got: frames done of the planned, and its seeks so far (null before the frame pass). */
export type PoseReached = { readonly done: number; readonly of: number; readonly seek: SeekTiming };

export type PoseFailure = "aborted" | "timeout" | "load" | "video" | "detect";
export class PoseError extends Error {
  readonly reason: PoseFailure;
  /** Set by runPose when it fails inside the frame pass (clip-debug), else null. */
  reached: PoseReached | null = null;
  constructor(reason: PoseFailure, message: string) {
    super(message);
    this.name = "PoseError";
    this.reason = reason;
  }
}

/** The seek timing of a list of per-seek durations (ms), in frame order. Pure. */
export function seekTiming(ms: readonly number[]): SeekTiming {
  if (ms.length === 0) return { count: 0, meanMs: 0, maxMs: 0, maxAt: null };
  let maxAt = 0;
  for (let i = 1; i < ms.length; i++) if (ms[i] > ms[maxAt]) maxAt = i;
  return { count: ms.length, meanMs: ms.reduce((a, b) => a + b, 0) / ms.length, maxMs: ms[maxAt], maxAt };
}

/** MediaPipe's vision tasks upload every frame through WebGL2, even with the CPU delegate. */
function hasWebGl2(): boolean {
  const gl = document.createElement("canvas").getContext("webgl2");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

async function createLandmarker(runningMode: "VIDEO" | "IMAGE"): Promise<PoseLandmarker> {
  if (!hasWebGl2()) throw new PoseError("load", "ingen WebGL2 i browseren");
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
    runningMode,
    numPoses: 1,
  });
}

/** The landmarker, from this origin only, in VIDEO mode (production's runs). The caller closes it. */
export function createPose(): Promise<PoseLandmarker> {
  return createLandmarker("VIDEO");
}

/** The same model and delegate in IMAGE mode: every detect() stands alone, no tracking (debug images only). The caller closes it. */
export function createImagePose(): Promise<PoseLandmarker> {
  return createLandmarker("IMAGE");
}

/** Rejects with the signal's reason once it aborts. */
export function untilAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Resolves on the media event, rejects on an error event or after ms. */
function mediaEvent(video: HTMLVideoElement, name: string, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener(name, ok);
      video.removeEventListener("error", bad);
    };
    const ok = () => {
      done();
      resolve();
    };
    const bad = () => {
      done();
      reject(new PoseError("video", "videoen kunne ikke læses"));
    };
    const timer = setTimeout(() => {
      done();
      reject(new PoseError("video", `${name} kom ikke inden for ${ms / 1000} s`));
    }, ms);
    video.addEventListener(name, ok, { once: true });
    video.addEventListener("error", bad, { once: true });
  });
}

/**
 * The clip's length (s). A MediaRecorder file may report Infinity until the end has been seeked to.
 * The probe's seek is waited out (its seeked) before returning, so the first frame's seek can't be
 * answered by the probe's seeked and detect frame 0 at the clip's end.
 */
async function durationOf(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  const changed = mediaEvent(video, "durationchange", 5000);
  const settled = mediaEvent(video, "seeked", 5000);
  settled.catch(() => undefined); // unawaited when the seek already settled or durationchange failed
  video.currentTime = 1e7;
  await changed;
  if (video.seeking) await settled;
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
}

/** Frame times (s, ms-rounded) at i / fps from 0, stopping before the duration; never a running sum. */
export function frameTimes(duration: number, fps: number): number[] {
  if (!Number.isFinite(fps) || fps <= 0) throw new PoseError("video", `ugyldig fps: ${fps}`);
  const times: number[] = [];
  for (let i = 0; i / fps < duration; i++) times.push(Math.round((i / fps) * 1000) / 1000);
  return times;
}

/**
 * Pose on a recorded clip: a detached <video> on a blob URL, seeked in 1/fps steps, detectForVideo
 * per frame, yielding to the event loop between frames. Aborts on the signal or after POSE_CAP_MS.
 * The blob URL is revoked and the landmarker closed on every way out.
 */
export async function runPose(
  blob: Blob,
  opts: { readonly fps?: number; readonly signal?: AbortSignal; readonly onProgress?: (done: number, of: number) => void } = {},
): Promise<PoseRun> {
  const fps = opts.fps ?? 5;
  if (!Number.isFinite(fps) || fps <= 0) throw new PoseError("video", `ugyldig fps: ${fps}`);
  const started = performance.now();
  const ctrl = new AbortController();
  const cap = setTimeout(() => ctrl.abort(new PoseError("timeout", `over ${POSE_CAP_MS / 1000} s`)), POSE_CAP_MS);
  const outer = opts.signal;
  const onOuter = () => ctrl.abort(new PoseError("aborted", "afbrudt"));
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  const signal = ctrl.signal;

  let landmarker: PoseLandmarker | null = null;
  let reached: (() => PoseReached) | null = null;
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  try {
    const loading = createPose();
    // A landmarker that arrives after an abort is closed at once.
    loading.then(
      (l) => {
        if (signal.aborted) l.close();
      },
      () => undefined,
    );
    try {
      landmarker = await untilAbort(loading, signal);
    } catch (error) {
      if (error instanceof PoseError) throw error;
      throw new PoseError("load", error instanceof Error ? error.message : String(error));
    }
    const loadMs = performance.now() - started;

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const meta = mediaEvent(video, "loadedmetadata", 10_000);
    video.src = url;
    await untilAbort(meta, signal);
    const duration = await untilAbort(durationOf(video), signal);
    if (duration <= 0) throw new PoseError("video", "ingen længde");

    const times = frameTimes(duration, fps);
    const frames: PoseFrame[] = [];
    const seekMs: number[] = [];
    let detectMs = 0;
    const pass = performance.now();
    reached = () => ({ done: frames.length, of: times.length, seek: seekTiming(seekMs) });
    for (const t of times) {
      const seeked = mediaEvent(video, "seeked", 5000);
      const seekStart = performance.now();
      video.currentTime = t;
      try {
        await untilAbort(seeked, signal);
      } finally {
        seekMs.push(performance.now() - seekStart); // a timed-out seek counts with its wait
      }
      const before = performance.now();
      let found: PoseFrame["landmarks"];
      try {
        const result = landmarker.detectForVideo(video, Math.round(t * 1000));
        const person = result.landmarks[0];
        found = person === undefined ? null : person.map((p) => [p.x, p.y, p.visibility] as const);
      } catch (error) {
        throw new PoseError("detect", error instanceof Error ? error.message : String(error));
      }
      detectMs += performance.now() - before;
      frames.push({ t, landmarks: found });
      opts.onProgress?.(frames.length, times.length);
      await untilAbort(new Promise((r) => setTimeout(r, 0)), signal);
    }
    const totalMs = performance.now() - pass;
    return {
      frames,
      timing: { loadMs, frames: frames.length, msPerFrame: frames.length === 0 ? 0 : detectMs / frames.length, totalMs },
      seek: seekTiming(seekMs),
    };
  } catch (error) {
    if (error instanceof PoseError && reached !== null) error.reached = reached();
    throw error;
  } finally {
    clearTimeout(cap);
    outer?.removeEventListener("abort", onOuter);
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    landmarker?.close();
  }
}
