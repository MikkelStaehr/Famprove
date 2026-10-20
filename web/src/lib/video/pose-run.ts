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
/** The wall-time cap of one run, load included: at least this, more for a long clip (poseCapMs). */
export const POSE_CAP_MS = 90_000;

/** The cap for a clip of durationS (slice clip-auto-2): max(90 s, duration × 1.5 + 30 s); POSE_CAP_MS while unknown. */
export function poseCapMs(durationS: number | null): number {
  if (durationS === null || !Number.isFinite(durationS) || durationS <= 0) return POSE_CAP_MS;
  return Math.max(POSE_CAP_MS, Math.round(durationS * 1500 + 30_000));
}

/**
 * How runPose reaches the frames: "seek" steps currentTime in 1/fps (each seek decodes from the
 * keyframe before it, slow when keyframes are far apart); "play" plays the clip once at
 * PLAY_RATE on an offscreen element and samples requestVideoFrameCallback (slice clip-auto-2).
 */
export type PoseMode = "seek" | "play";
export const PLAY_RATE = 2;

/** One landmark: normalised x, y and visibility (0–1). */
export type PosePoint = readonly [x: number, y: number, visibility: number];
/** One sampled frame: its time in the clip (s) and the 33 landmarks of one person, or null when none was found. */
export type PoseFrame = { readonly t: number; readonly landmarks: readonly PosePoint[] | null };
/** loadMs: WASM + model; totalMs: the frame pass (seeks + detection); msPerFrame: mean detection time. */
export type PoseTiming = { readonly loadMs: number; readonly frames: number; readonly msPerFrame: number; readonly totalMs: number };
/** Per-seek wall time (slice clip-debug): count, mean and max (ms), and the frame index of the max (null with no seek). */
export type SeekTiming = { readonly count: number; readonly meanMs: number; readonly maxMs: number; readonly maxAt: number | null };
export type PoseResult = { readonly frames: readonly PoseFrame[]; readonly timing: PoseTiming };
/** runPose's result: PoseResult plus clip-debug's seek timing (empty in play mode) and the mode (a sibling type, so PoseResult keeps its meaning). */
export type PoseRun = PoseResult & { readonly seek: SeekTiming; readonly mode: PoseMode };

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

/** The part of Document abortWhenHidden reads (a fake in node tests). */
export type VisibilityDoc = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/** Aborts `ctrl` with PoseError "aborted" now if the page is hidden, or once it is; returns the unwatch. */
export function abortWhenHidden(doc: VisibilityDoc, ctrl: AbortController): () => void {
  const onHidden = () => {
    if (doc.visibilityState === "hidden") ctrl.abort(new PoseError("aborted", "siden blev skjult"));
  };
  doc.addEventListener("visibilitychange", onHidden);
  onHidden();
  return () => doc.removeEventListener("visibilitychange", onHidden);
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

/** How long play() may take to start playing (play mode). */
const PLAY_START_MS = 10_000;
/** A play pass with fewer frames than this share of the expected count failed (play mode). */
const PLAY_MIN_SHARE = 0.3;

/** The offscreen element of a play run: in the DOM (a detached element may not play), never seen or reached. */
function attachOffscreen(video: HTMLVideoElement): void {
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(video);
}

type Detect = (video: HTMLVideoElement, t: number, ts: number) => PoseFrame["landmarks"];

/** Seek mode's frame pass: currentTime in 1/fps steps, one detect per seek, yielding between frames. */
async function seekPass(video: HTMLVideoElement, times: readonly number[], detect: Detect, frames: PoseFrame[], seekMs: number[], signal: AbortSignal, onProgress: ((done: number, of: number) => void) | undefined): Promise<void> {
  for (const t of times) {
    const seeked = mediaEvent(video, "seeked", 5000);
    const seekStart = performance.now();
    video.currentTime = t;
    try {
      await untilAbort(seeked, signal);
    } finally {
      seekMs.push(performance.now() - seekStart); // a timed-out seek counts with its wait
    }
    frames.push({ t, landmarks: detect(video, t, Math.round(t * 1000)) });
    onProgress?.(frames.length, times.length);
    await untilAbort(new Promise((r) => setTimeout(r, 0)), signal);
  }
}

/**
 * Play mode's frame pass: plays once from 0 at PLAY_RATE, muted, and detects on the frames
 * requestVideoFrameCallback hands over whose mediaTime is ≥ 1/fps after the last one sampled (so at
 * most fps of media time), with times and timestamps strictly increasing.
 */
async function playPass(video: HTMLVideoElement, of: number, fps: number, detect: Detect, frames: PoseFrame[], signal: AbortSignal, onProgress: ((done: number, of: number) => void) | undefined): Promise<void> {
  if (typeof video.requestVideoFrameCallback !== "function") throw new PoseError("video", "requestVideoFrameCallback findes ikke i browseren");
  let handle = 0;
  let lastT = -Infinity;
  let lastTs = -1;
  let begun = false; // an "ended" left over from durationOf's probe at the end is never the end of this pass
  const onEnded = { resolve: () => undefined as void };
  const endedListener = () => {
    if (begun) onEnded.resolve();
  };
  try {
    const ended = new Promise<void>((resolve, reject) => {
      onEnded.resolve = resolve;
      video.addEventListener("ended", endedListener);
      video.addEventListener("error", () => reject(new PoseError("video", "videoen kunne ikke afspilles")), { once: true });
      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        const t = Math.round(meta.mediaTime * 1000) / 1000;
        if (t > lastT && t - lastT >= 1 / fps - 1e-6) {
          lastT = t;
          lastTs = Math.max(lastTs + 1, Math.round(t * 1000)); // detectForVideo needs increasing timestamps
          try {
            frames.push({ t, landmarks: detect(video, t, lastTs) });
          } catch (error) {
            reject(error);
            return;
          }
          onProgress?.(Math.min(frames.length, of), of);
        }
        handle = video.requestVideoFrameCallback(onFrame);
      };
      handle = video.requestVideoFrameCallback(onFrame);
    });
    ended.catch(() => undefined); // awaited below; an abort may leave it unsettled
    video.currentTime = 0;
    video.playbackRate = PLAY_RATE;
    begun = true;
    try {
      // A play() that never settles fails after PLAY_START_MS rather than waiting for the cap.
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        startTimer = setTimeout(() => reject(new PoseError("video", `afspilningen startede ikke inden for ${PLAY_START_MS / 1000} s`)), PLAY_START_MS);
      });
      try {
        await untilAbort(Promise.race([video.play(), late]), signal);
      } finally {
        clearTimeout(startTimer);
      }
    } catch (error) {
      if (error instanceof PoseError) throw error;
      throw new PoseError("video", error instanceof Error ? error.message : String(error));
    }
    await untilAbort(ended, signal);
    // A browser that throttles the offscreen element hands over few frames or none (review
    // 2026-10-20): a video error, so analyseClip retries in seek mode rather than storing a
    // low_confidence that is never re-run.
    if (frames.length < PLAY_MIN_SHARE * of) throw new PoseError("video", `afspilning gav kun ${frames.length} af ${of} billeder`);
  } finally {
    video.removeEventListener("ended", endedListener);
    video.cancelVideoFrameCallback?.(handle);
    video.pause();
  }
}

/**
 * Pose on a recorded clip: a <video> on a blob URL (seek mode: detached; play mode: offscreen in
 * the DOM), the frames reached by seeking or by playing (PoseMode), detectForVideo per frame. Aborts
 * on the signal, after poseCapMs of the clip's length, or (every mode, clip-auto-3) when the page is
 * hidden, since Chrome throttles timers and media there (an 18-minute hang on the phone): PoseError "aborted", nothing written, the pickup retries later. The
 * blob URL is revoked, the element removed and the landmarker closed on every way out.
 */
export async function runPose(
  blob: Blob,
  opts: { readonly fps?: number; readonly mode?: PoseMode; readonly signal?: AbortSignal; readonly onProgress?: (done: number, of: number) => void } = {},
): Promise<PoseRun> {
  const fps = opts.fps ?? 5;
  const mode = opts.mode ?? "seek";
  if (!Number.isFinite(fps) || fps <= 0) throw new PoseError("video", `ugyldig fps: ${fps}`);
  const started = performance.now();
  const ctrl = new AbortController();
  let cap = setTimeout(() => ctrl.abort(new PoseError("timeout", `over ${POSE_CAP_MS / 1000} s`)), POSE_CAP_MS);
  const outer = opts.signal;
  const onOuter = () => ctrl.abort(new PoseError("aborted", "afbrudt"));
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  const unwatch = abortWhenHidden(document, ctrl);
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
    const lm = landmarker;

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (mode === "play") attachOffscreen(video);
    const meta = mediaEvent(video, "loadedmetadata", 10_000);
    video.src = url;
    await untilAbort(meta, signal);
    const duration = await untilAbort(durationOf(video), signal);
    if (duration <= 0) throw new PoseError("video", "ingen længde");
    const capMs = poseCapMs(duration);
    clearTimeout(cap);
    cap = setTimeout(() => ctrl.abort(new PoseError("timeout", `over ${Math.round(capMs / 1000)} s`)), Math.max(0, capMs - (performance.now() - started)));

    const times = frameTimes(duration, fps);
    const frames: PoseFrame[] = [];
    const seekMs: number[] = [];
    let detectMs = 0;
    const detect: Detect = (v, _t, ts) => {
      const before = performance.now();
      try {
        const person = lm.detectForVideo(v, ts).landmarks[0];
        return person === undefined ? null : person.map((p) => [p.x, p.y, p.visibility] as const);
      } catch (error) {
        throw new PoseError("detect", error instanceof Error ? error.message : String(error));
      } finally {
        detectMs += performance.now() - before;
      }
    };
    const pass = performance.now();
    reached = () => ({ done: frames.length, of: times.length, seek: seekTiming(seekMs) });
    if (mode === "seek") await seekPass(video, times, detect, frames, seekMs, signal, opts.onProgress);
    else await playPass(video, times.length, fps, detect, frames, signal, opts.onProgress);
    const totalMs = performance.now() - pass;
    return {
      frames,
      timing: { loadMs, frames: frames.length, msPerFrame: frames.length === 0 ? 0 : detectMs / frames.length, totalMs },
      seek: seekTiming(seekMs),
      mode,
    };
  } catch (error) {
    if (error instanceof PoseError && reached !== null) error.reached = reached();
    throw error;
  } finally {
    clearTimeout(cap);
    outer?.removeEventListener("abort", onOuter);
    unwatch();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
    landmarker?.close();
  }
}
