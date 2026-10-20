"use client";

import { useEffect, useRef, useState } from "react";

import {
  type CameraResult,
  type DiagOutcome,
  type DiagResources,
  diagResources,
  errorText,
  formatCamera,
  formatReport,
  jointsSeenShare,
  otherKeys,
  pickDiag,
  poseLine,
  poseReason,
  zoomMinOf,
} from "@/lib/video/camera-diag";
import { keyframeLines, type KeyframeLines } from "@/lib/video/cut-lines";
import { pickRecorderType, recorderOptions } from "@/lib/video/mime";

/** The keyframe test clip's length (clip-cut §6). */
const TEST_CLIP_MS = 4000;

/** The keyframe lines and the test clip, which the caller keeps only until Pose has run on it (clip-pose). */
type KeyframeTest = { readonly lines: KeyframeLines; readonly recording: Blob | null };

/**
 * clip-cut §6: a 4 s clip at 960×720 with the recorder's options, its keyframe spacing measured on
 * the recording. The tracks go into the run's resources (released on every way out); the recording
 * is handed back for the Pose run and dropped after it. null = the run was released.
 */
async function keyframeTest(devices: readonly MediaDeviceInfo[], run: DiagResources): Promise<KeyframeTest | null> {
  const type = pickRecorderType(typeof MediaRecorder === "undefined" ? undefined : (t) => MediaRecorder.isTypeSupported(t));
  if (type === null) return { lines: { line: "Afstanden kunne ikke måles.", warning: null }, recording: null };
  const device = devices.find((d) => /back|rear|environment|bag/i.test(d.label)) ?? devices[0];
  if (device === undefined) return null;
  let stream: MediaStream;
  try {
    stream = await openCamera({ deviceId: { exact: device.deviceId }, width: { ideal: 960 }, height: { ideal: 720 } });
  } catch {
    return run.released ? null : { lines: { line: "Afstanden kunne ikke måles.", warning: null }, recording: null };
  }
  if (!run.addTracks(stream.getTracks())) return null;
  let chunks: Blob[] = [];
  try {
    const rec = new MediaRecorder(stream, recorderOptions(type));
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.start(1000);
    for (let waited = 0; waited < TEST_CLIP_MS && !run.released; waited += 200) await new Promise((r) => setTimeout(r, 200));
    if (rec.state !== "inactive") rec.stop();
    await withTimeout(stopped, 5_000, "MediaRecorder.stop");
  } catch {
    chunks = [];
  }
  run.stopTracks();
  if (run.released) return null;
  const recording = chunks.length === 0 ? null : new Blob(chunks, { type: type.fileType });
  chunks = [];
  if (type.ext === "webm" || recording === null) return { lines: keyframeLines(null, type.mimeType), recording };
  try {
    const { keyframeTimes } = await import("@/lib/video/cut");
    return { lines: keyframeLines(await keyframeTimes(recording), type.mimeType), recording };
  } catch {
    return { lines: keyframeLines(null, type.mimeType), recording };
  }
}

/** clip-pose: Pose lite on the test clip, as Kameratest's one line. Aborted by the signal (every way out). */
async function poseTest(recording: Blob | null, signal: AbortSignal): Promise<string> {
  if (recording === null) return poseLine({ ok: false, reason: "intet testklip" });
  try {
    const { runPose } = await import("@/lib/video/pose-run");
    const r = await runPose(recording, { fps: 5, signal });
    return poseLine({ ok: true, timing: r.timing, seenShare: jointsSeenShare(r.frames) });
  } catch (error) {
    return poseLine({ ok: false, reason: poseReason(error) });
  }
}

const BTN = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const PRIMARY = `inline-flex min-h-11 items-center justify-center rounded-full bg-inverse-bg px-5 font-sans text-14 font-medium text-inverse-text disabled:opacity-50 ${BTN}`;
const SECONDARY = `inline-flex min-h-11 items-center justify-center rounded-full bg-track px-4 font-sans text-14 font-medium text-text disabled:opacity-50 ${BTN}`;

/** A browser step that may never settle (a stuck camera): fails after ms. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} svarede ikke inden for ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** One camera, video only, with a timeout; a stream that arrives after it is stopped at once, so no lens stays on (security, 2026-10-20). */
async function openCamera(video: MediaTrackConstraints): Promise<MediaStream> {
  const asked = navigator.mediaDevices.getUserMedia({ video, audio: false });
  try {
    return await withTimeout(asked, 10_000, "getUserMedia");
  } catch (error) {
    asked.then(
      (late) => late.getTracks().forEach((t) => t.stop()),
      () => undefined,
    );
    throw error;
  }
}

async function tryConstraints(track: MediaStreamTrack, c: MediaTrackConstraints): Promise<DiagOutcome> {
  try {
    await withTimeout(track.applyConstraints(c), 5000, "applyConstraints");
    return { ok: true, settings: pickDiag(track.getSettings()) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** One frame of the stream as a JPEG blob, at the video's own size. */
async function grabFrame(stream: MediaStream): Promise<{ blob: Blob; width: number; height: number }> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await withTimeout(video.play(), 5000, "video");
    if (video.videoWidth === 0) {
      await withTimeout(new Promise<void>((r) => video.addEventListener("loadeddata", () => r(), { once: true })), 5000, "billede");
    }
    await new Promise((r) => setTimeout(r, 300)); // let exposure settle a little
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("canvas uden 2d");
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (blob === null) throw new Error("toBlob gav intet");
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

type Shown = CameraResult & { readonly shotUrl: string | null };

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly at: number; readonly of: number }
  | { readonly kind: "pose" } // Pose runs on the test clip
  | { readonly kind: "done" }
  | { readonly kind: "stopped" } // the page was hidden mid-run or after: tracks stopped, shots revoked
  | { readonly kind: "error"; readonly text: string };

/** One camera, opened alone by deviceId; its tracks are stopped before this returns. */
async function testCamera(device: MediaDeviceInfo, index: number, res: DiagResources): Promise<Shown | null> {
  let stream: MediaStream;
  try {
    stream = await openCamera({ deviceId: { exact: device.deviceId } });
  } catch (error) {
    const failed: DiagOutcome = { ok: false, error: errorText(error) };
    return { index, label: device.label, open: failed, capabilities: null, otherCapabilities: [], tries: [], zoomMin: null, shot: null, shotUrl: null };
  }
  if (!res.addTracks(stream.getTracks())) return null;
  try {
    const track = stream.getVideoTracks()[0];
    if (track === undefined) throw new Error("ingen videospor");
    const open: DiagOutcome = { ok: true, settings: pickDiag(track.getSettings()) };
    const raw: unknown = typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
    const capabilities = raw === null ? null : pickDiag(raw);
    // 4:3 last, so the test shot (after zoom min) shows the frame camera-wide will record.
    const tries = [
      { name: "1280×720", outcome: await tryConstraints(track, { width: { ideal: 1280 }, height: { ideal: 720 } }) },
      { name: "960×720 (4:3)", outcome: await tryConstraints(track, { width: { ideal: 960 }, height: { ideal: 720 }, aspectRatio: { ideal: 4 / 3 } }) },
    ];
    const min = zoomMinOf(capabilities);
    // zoom is not in TypeScript's MediaTrackConstraintSet yet (Image Capture spec); the browser reads it.
    const zoomMin = min === null ? null : await tryConstraints(track, { advanced: [{ zoom: min } as MediaTrackConstraintSet] });
    if (res.released) return null;
    let shot: CameraResult["shot"];
    let shotUrl: string | null = null;
    try {
      const frame = await grabFrame(stream);
      const url = URL.createObjectURL(frame.blob);
      if (!res.addUrl(url)) return null;
      shotUrl = url;
      shot = { width: frame.width, height: frame.height };
    } catch (error) {
      shot = { error: errorText(error) };
    }
    return { index, label: device.label, open, capabilities, otherCapabilities: otherKeys(raw), tries, zoomMin, shot, shotUrl };
  } finally {
    res.stopTracks();
  }
}

/** /kamera: each camera's lenses, zoom and sizes plus a test shot; text only leaves by Kopiér alt. */
export function CameraDiag() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cameras, setCameras] = useState<Shown[]>([]);
  const [copied, setCopied] = useState<string>("");
  const [keyframes, setKeyframes] = useState<KeyframeLines | null>(null);
  const [pose, setPose] = useState<string | null>(null);
  const res = useRef<DiagResources | null>(null);
  const poseAbort = useRef<AbortController | null>(null);

  // Every way out (CLAUDE.md lifecycles): unmount, page hidden (incl. bfcache) and back.
  useEffect(() => {
    const stop = () => {
      poseAbort.current?.abort();
      const current = res.current;
      if (current === null || current.released) return;
      current.release();
      setCameras((list) => list.map((c) => ({ ...c, shotUrl: null })));
      setPhase((p) => (p.kind === "idle" || p.kind === "error" ? p : { kind: "stopped" }));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("popstate", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("popstate", stop);
      poseAbort.current?.abort();
      res.current?.release();
    };
  }, []);

  async function start() {
    poseAbort.current?.abort();
    res.current?.release();
    const run = diagResources((url) => URL.revokeObjectURL(url));
    res.current = run;
    const abort = new AbortController();
    poseAbort.current = abort;
    setCameras([]);
    setCopied("");
    setKeyframes(null);
    setPose(null);
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setPhase({ kind: "error", text: "Denne browser giver ikke adgang til kameraet." });
      return;
    }
    setPhase({ kind: "running", at: 0, of: 0 });
    let devices: MediaDeviceInfo[];
    try {
      const permission = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (!run.addTracks(permission.getTracks())) return;
      run.stopTracks(); // labels stay readable once permission is given
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    } catch (error) {
      run.stopTracks();
      if (!run.released) setPhase({ kind: "error", text: `Fik ikke adgang til kameraet (${errorText(error)}). Tillad kamera for siden, og prøv igen.` });
      return;
    }
    for (let i = 0; i < devices.length; i++) {
      if (run.released) return;
      setPhase({ kind: "running", at: i + 1, of: devices.length });
      const result = await testCamera(devices[i] as MediaDeviceInfo, i + 1, run);
      if (result === null || run.released) return;
      setCameras((list) => [...list, result]);
    }
    if (devices.length > 0 && !run.released) {
      setPhase({ kind: "running", at: devices.length, of: devices.length });
      const kf = await keyframeTest(devices, run);
      if (kf === null || run.released) return;
      setKeyframes(kf.lines);
      setPhase({ kind: "pose" });
      // The clip lives only until Pose has run on it; nothing keeps it after this run.
      const line = await poseTest(kf.recording, abort.signal);
      if (run.released || abort.signal.aborted) return;
      setPose(line);
    }
    if (!run.released) setPhase(devices.length === 0 ? { kind: "error", text: "Browseren viser ingen kameraer." } : { kind: "done" });
  }

  async function copyAll() {
    try {
      const kf = keyframes === null ? "" : `\n\n${keyframes.line}${keyframes.warning === null ? "" : `\n${keyframes.warning}`}`;
      const ps = pose === null ? "" : `\n${pose}`;
      await navigator.clipboard.writeText(`${formatReport(cameras, new Date())}${kf}${ps}`);
      setCopied("Kopieret.");
    } catch {
      setCopied("Kunne ikke kopiere. Markér teksten, og kopiér selv.");
    }
  }

  const running = phase.kind === "running" || phase.kind === "pose";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={() => void start()} disabled={running}>
          {phase.kind === "idle" ? "Start" : "Start igen"}
        </button>
        {cameras.length > 0 && !running && (
          <button type="button" className={SECONDARY} onClick={() => void copyAll()}>
            Kopiér alt
          </button>
        )}
      </div>
      <p role="status" className="font-sans text-13 text-text-muted">
        {phase.kind === "running"
          ? phase.of === 0
            ? "Spørger om adgang til kameraet …"
            : `Tester kamera ${phase.at} af ${phase.of} …`
          : phase.kind === "pose"
            ? "Måler kropsgenkendelsen på testklippet …"
            : phase.kind === "done"
            ? `${cameras.length} ${cameras.length === 1 ? "kamera" : "kameraer"} testet.`
            : phase.kind === "stopped"
              ? "Stoppet, da siden blev skjult. Kameraet er lukket, og testbillederne er fjernet."
              : ""}
        {copied !== "" && ` ${copied}`}
      </p>
      {keyframes !== null && (
        <div className="flex flex-col gap-1">
          <p className={`font-mono text-13 ${keyframes.line.startsWith("◆") ? "text-warning" : "text-text-muted"}`}>{keyframes.line}</p>
          {keyframes.warning !== null && <p className="font-mono text-13 text-warning">{keyframes.warning}</p>}
          {pose !== null && <p className="font-mono text-13 text-text-muted">{pose}</p>}
        </div>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="font-sans text-14 text-text">
          {phase.text}
        </p>
      )}
      {cameras.map((c) => (
        <section key={c.index} aria-labelledby={`kamera-${c.index}`} className="rounded-card border border-border bg-card p-4.5">
          <h2 id={`kamera-${c.index}`} className="font-sans text-16 font-medium text-text">
            Kamera {c.index}
          </h2>
          {c.shotUrl !== null && (
            // A blob URL of a local frame: next/image can't optimise it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.shotUrl} alt={`Testbillede fra kamera ${c.index}`} className="mt-3 w-full rounded-tile bg-track" />
          )}
          <pre className="mt-3 overflow-x-auto font-mono text-12 whitespace-pre-wrap text-text-muted">{formatCamera(c)}</pre>
        </section>
      ))}
    </div>
  );
}
