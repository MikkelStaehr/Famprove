/**
 * The debug panel's debug images (slice clip-debug), never wired into production ("Fejlsøg
 * (afspil)" is runPose's play mode since clip-auto-2, the run production uses): each image detects
 * a frame twice, on the <video> (what runPose sees) and on a canvas copy of it with a separate IMAGE-mode landmarker (each detect() fresh, no tracking carried
 * from one to the other), so a rotation mismatch shows. Landmarks and canvases stay in memory; nothing
 * is stored or sent. The landmarker is closed on every way out.
 */
import { createImagePose, createPose, type PosePoint, PoseError, untilAbort } from "./pose-run";
import { type FrameCheck, frameCheck } from "./debug-log";

type Landmarker = Awaited<ReturnType<typeof createPose>>;

/** Waits for a landmarker; one that arrives after an abort is closed at once (as runPose does). */
function landmarkerFor(loading: Promise<Landmarker>, signal: AbortSignal): Promise<Landmarker> {
  loading.then(
    (l) => {
      if (signal.aborted) l.close();
    },
    () => undefined,
  );
  return untilAbort(loading, signal);
}

const points = (r: { landmarks: { x: number; y: number; visibility: number }[][] }): PosePoint[] | null => {
  const p = r.landmarks[0];
  return p === undefined ? null : p.map((q) => [q.x, q.y, q.visibility] as const);
};

/** One debug image: the canvas with both skeletons drawn, and each detection's check. */
export type DebugImage = { readonly pct: number; readonly t: number; readonly canvas: HTMLCanvasElement; readonly video: FrameCheck; readonly copy: FrameCheck };

function seekTo(video: HTMLVideoElement, t: number, signal: AbortSignal): Promise<void> {
  const seeked = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PoseError("video", "seeked kom ikke inden for 10 s")), 10_000);
    video.addEventListener("seeked", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  video.currentTime = t;
  return untilAbort(seeked, signal);
}

function draw(ctx: CanvasRenderingContext2D, pts: readonly PosePoint[] | null, links: readonly { start: number; end: number }[], colour: string, dash: number[]) {
  if (pts === null) return;
  const { width: w, height: h } = ctx.canvas;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(2, w / 200);
  ctx.setLineDash(dash);
  for (const l of links) {
    const a = pts[l.start];
    const b = pts[l.end];
    if (a === undefined || b === undefined) continue;
    ctx.beginPath();
    ctx.moveTo(a[0] * w, a[1] * h);
    ctx.lineTo(b[0] * w, b[1] * h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const r = Math.max(3, w / 120);
  for (const p of pts) {
    ctx.beginPath();
    if (dash.length === 0) ctx.arc(p[0] * w, p[1] * h, r, 0, Math.PI * 2);
    else ctx.rect(p[0] * w - r, p[1] * h - r, 2 * r, 2 * r); // the canvas set: squares, not dots
    if (dash.length === 0) ctx.fill();
    else ctx.stroke();
  }
}

/** Three debug images at 25/50/75 % of the clip, from a detached <video> on `url`. */
export async function debugImages(url: string, colours: { readonly video: string; readonly canvas: string }, signal: AbortSignal): Promise<DebugImage[]> {
  const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const landmarker = await landmarkerFor(createImagePose(), signal); // IMAGE mode: the two detections never share tracking
  const video = document.createElement("video");
  const out: DebugImage[] = [];
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const meta = new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new PoseError("video", "videoen kunne ikke læses")), { once: true });
    });
    video.src = url;
    await untilAbort(meta, signal);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration <= 0) throw new PoseError("video", "ingen længde");
    for (const pct of [25, 50, 75]) {
      const t = (duration * pct) / 100;
      await seekTo(video, t, signal);
      const fromVideo = points(landmarker.detect(video));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new PoseError("video", "ingen 2d-canvas");
      ctx.drawImage(video, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      let fromCanvas: PosePoint[] | null;
      try {
        fromCanvas = points(landmarker.detect(bitmap));
      } finally {
        bitmap.close();
      }
      draw(ctx, fromVideo, PoseLandmarker.POSE_CONNECTIONS, colours.video, []);
      draw(ctx, fromCanvas, PoseLandmarker.POSE_CONNECTIONS, colours.canvas, [Math.max(6, canvas.width / 60), Math.max(4, canvas.width / 90)]);
      out.push({ pct, t: Math.round(t * 10) / 10, canvas, video: frameCheck(fromVideo), copy: frameCheck(fromCanvas) });
    }
    return out;
  } finally {
    video.removeAttribute("src");
    video.load();
    landmarker.close();
  }
}
