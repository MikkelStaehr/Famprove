/**
 * analyseClip's real dependencies (clip-auto): the model probe, the keyframe read (cut.ts's parse),
 * MediaPipe's runPose and the setClipAuto action. The model is fetched from this origin only; "only-if-cached" tells whether
 * the HTTP cache already holds it (then no model phase), else one download with a byte % fills the
 * cache, so MediaPipe's own fetch of MODEL_PATH is answered from it.
 */
import { setClipAuto } from "@/app/actions";
import { type AutoDeps, bytePct } from "./auto-run";
import { MODEL_PATH, runPose } from "./pose-run";

async function cached(): Promise<boolean> {
  try {
    const r = await fetch(MODEL_PATH, { cache: "only-if-cached", mode: "same-origin" });
    if (r.ok) {
      await r.body?.cancel();
      return true;
    }
  } catch {
    // not cached (or the browser has no only-if-cached): download it
  }
  return false;
}

async function warmModel(signal: AbortSignal, onPct: (pct: number | null) => void): Promise<boolean> {
  if (await cached()) return false;
  onPct(null);
  const r = await fetch(MODEL_PATH, { signal });
  if (!r.ok || r.body === null) return true; // MediaPipe's own load reports the failure
  const lengthHeader = r.headers.get("content-length");
  const total = lengthHeader === null ? null : Number(lengthHeader);
  const reader = r.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    onPct(bytePct(received, total !== null && Number.isFinite(total) ? total : null));
  }
  return true;
}

export const browserAutoDeps: AutoDeps = {
  warmModel,
  keyframeTimes: async (blob) => (await import("./cut")).keyframeTimes(blob), // mp4box only when a clip is analysed
  runPose: (blob, opts) => runPose(blob, opts),
  setClipAuto: (input) => setClipAuto(input),
  now: () => performance.now(),
};
