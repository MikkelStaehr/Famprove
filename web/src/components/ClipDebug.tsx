"use client";

/**
 * The player's hidden debug panel (slice clip-debug): opened by a long-press on the title or
 * Shift+D. Fejlsøg runs the file facts, production's runPose (seek) + diagnoseLift and three debug
 * images; Fejlsøg (afspil) is the A/B without seeking; Analysér igen is production's analyseClip
 * with its setClipAuto write (the only thing sent); Kopiér log copies the aggregates. Canvases live
 * in memory and are dropped, runs aborted and the landmarker closed on close, unmount or page hidden.
 */
import { useEffect, useRef, useState } from "react";
import { diagnoseLift } from "@/lib/video/auto-clip";
import type { ClipLiftMeta } from "@/lib/video/auto-lines";
import { type AutoOutcome, analyseClip, failureOf } from "@/lib/video/auto-run";
import { browserAutoDeps } from "@/lib/video/auto-run-browser";
import { browserStore, recordIfSaved } from "@/lib/video/auto-version";
import { type FileFacts, fileFacts } from "@/lib/video/cut";
import { type DebugRun, type ImageCheck, debugLog, releaseImages } from "@/lib/video/debug-log";
import { runPose } from "@/lib/video/pose-run";

const BTN = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const DARK_BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-track px-4 font-sans text-14 font-medium text-text disabled:text-text-muted ${BTN}`;

type Props = {
  readonly clipId: string;
  readonly label: string;
  readonly blob: Blob | null;
  readonly status: string | null;
  readonly durationS: number | null;
  readonly lift: ClipLiftMeta | null;
  /** The library's pickup is analysing this clip now: Analysér igen waits, so one run and one write at a time. */
  readonly pickupBusy: boolean;
  readonly onAuto: (out: AutoOutcome) => void;
  readonly onClose: () => void;
};

type Shot = { readonly check: ImageCheck; readonly url: string };

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "currentColor";
}

export function ClipDebug({ clipId, label, blob, status, durationS, lift, pickupBusy, onAuto, onClose }: Props) {
  const [facts, setFacts] = useState<FileFacts | { readonly error: string } | null>(null);
  const [videoSize, setVideoSize] = useState<{ readonly w: number; readonly h: number } | null>(null);
  const [runs, setRuns] = useState<readonly DebugRun[]>([]);
  const [images, setImages] = useState<readonly Shot[]>([]);
  const [reanalyse, setReanalyse] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);

  const stop = () => {
    ctrl.current?.abort(new Error("lukket"));
    ctrl.current = null;
    const released = releaseImages<Shot>(urls.current, (u) => URL.revokeObjectURL(u));
    urls.current = released.urls;
    setImages(released.images); // revoked and cleared together: no image is left on a dead URL
  };
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setBusy(null);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stop(); // unmount, close and back all unmount the panel
    };
  }, []);

  const url = (b: Blob): string => {
    const u = URL.createObjectURL(b);
    urls.current.push(u);
    return u;
  };

  const meta = { durationS: durationS ?? 0, family: lift?.family ?? "lower", expected: lift?.expected ?? null } as const;
  const ready = blob !== null && lift !== null && durationS !== null;

  async function fejlsoeg() {
    if (!ready || blob === null) return;
    stop();
    const c = new AbortController();
    ctrl.current = c;
    setRuns([]);
    try {
      setBusy("fil");
      try {
        setFacts(await fileFacts(blob));
      } catch (error) {
        setFacts({ error: error instanceof Error ? error.message : String(error) });
      }
      const started = performance.now();
      try {
        const pose = await runPose(blob, { mode: "seek", signal: c.signal, onProgress: (d, of) => setBusy(`søg ${d}/${of}`) });
        setRuns([{ mode: "seek", ok: true, diag: diagnoseLift(pose.frames, meta.expected, meta.family, meta.durationS), seek: pose.seek, ms: performance.now() - started }]);
      } catch (error) {
        if (c.signal.aborted) return;
        const f = failureOf("pose", error);
        setRuns([{ mode: "seek", ok: false, step: f.step, message: f.message, reached: f.reached, ms: performance.now() - started }]);
      }
      setBusy("billeder");
      const { debugImages } = await import("@/lib/video/pose-debug-browser");
      const src = url(blob);
      try {
        const shots = await debugImages(src, { video: token("--text"), canvas: token("--warning") }, c.signal);
        const made = await Promise.all(
          shots.map(
            (s) =>
              new Promise<Shot>((resolve) =>
                s.canvas.toBlob((b) => {
                  const check = { pct: s.pct, t: s.t, video: s.video, canvas: s.copy };
                  resolve({ check, url: b === null || c.signal.aborted ? "" : url(b) }); // after an abort, no URL is made
                  s.canvas.width = 0; // the canvas is dropped; only the in-memory blob URL shows it
                }),
              ),
          ),
        );
        if (!c.signal.aborted) {
          setImages(made);
          const v = document.createElement("video");
          v.src = src;
          v.addEventListener("loadedmetadata", () => {
            setVideoSize({ w: v.videoWidth, h: v.videoHeight });
            v.removeAttribute("src");
            v.load();
          }, { once: true });
        }
      } catch (error) {
        if (!c.signal.aborted) setReanalyse(`billeder fejlede: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (ctrl.current === c) setBusy(null);
    }
  }

  async function afspil() {
    if (!ready || blob === null) return;
    stop();
    const c = new AbortController();
    ctrl.current = c;
    const started = performance.now();
    setBusy("afspiller");
    try {
      const pose = await runPose(blob, { mode: "play", signal: c.signal, onProgress: (d, of) => setBusy(`afspil ${d}/${of}`) });
      setRuns((rs) => [...rs.filter((r) => r.mode !== "play"), { mode: "play", ok: true, diag: diagnoseLift(pose.frames, meta.expected, meta.family, meta.durationS), seek: null, ms: performance.now() - started }]);
    } catch (error) {
      if (c.signal.aborted) return;
      const f = failureOf("pose", error);
      setRuns((rs) => [...rs.filter((r) => r.mode !== "play"), { mode: "play", ok: false, step: f.step, message: f.message, reached: f.reached, ms: performance.now() - started }]);
    } finally {
      if (ctrl.current === c) setBusy(null);
    }
  }

  async function igen() {
    if (!ready || blob === null || lift === null || durationS === null || pickupBusy || busy !== null) return;
    stop();
    const c = new AbortController();
    ctrl.current = c;
    setBusy("analyserer");
    const out = await analyseClip(clipId, blob, { ext: "mp4", durationS, family: lift.family, expected: lift.expected }, {
      signal: c.signal,
      onProgress: (p) => setBusy(p.kind === "model" ? "model" : `analyserer ${p.pct} %`),
      deps: browserAutoDeps,
    });
    if (ctrl.current === c) setBusy(null);
    recordIfSaved(browserStore(), clipId, out);
    onAuto(out);
    const how = out.kind === "clipped" || out.kind === "low_confidence" || out.kind === "failed" ? ` · ${out.mode?.why ?? "ingen tilstand"}` : "";
    setReanalyse(
      out.kind === "failed"
        ? `failed (${out.error.step}: ${out.error.message}) · gemt ${out.saved ? "ja" : "nej"}${how}`
        : out.kind === "clipped"
          ? `clipped ${out.inS}–${out.outS} s · gemt ${out.saved ? "ja" : "nej"}${how}`
          : out.kind === "low_confidence"
            ? `low_confidence · gemt ${out.saved ? "ja" : "nej"}${how}`
            : out.kind,
    );
  }

  const log = debugLog({
    clip: { label, status, durationS, family: lift?.family ?? null, expected: lift?.expected ?? null },
    facts,
    videoSize,
    runs,
    images: images.map((i) => i.check),
    reanalyse,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(log);
      setCopied("Kopieret.");
    } catch {
      setCopied("Kunne ikke kopiere.");
    }
  }

  return (
    <section aria-label="Fejlsøg" className="mx-2 flex max-h-[45vh] flex-col gap-2 overflow-y-auto rounded-card border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-13 uppercase tracking-wide text-text-muted">Fejlsøg</h2>
        <button type="button" className={`min-h-11 px-2 font-sans text-13 text-text underline underline-offset-4 ${BTN}`} onClick={onClose}>
          Skjul
        </button>
      </div>
      {!ready ? (
        <p className="font-mono text-13 text-text-muted">{blob === null ? "Ingen video på telefonen." : "Klippet mangler øvelse eller længde."}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={DARK_BTN} disabled={busy !== null} onClick={() => void fejlsoeg()}>
            Fejlsøg
          </button>
          <button type="button" className={DARK_BTN} disabled={busy !== null} onClick={() => void afspil()}>
            Fejlsøg (afspil)
          </button>
          <button type="button" className={DARK_BTN} disabled={busy !== null || pickupBusy} onClick={() => void igen()}>
            Analysér igen
          </button>
        </div>
      )}
      <p role="status" className="font-mono text-13 text-text-muted">
        {busy}
      </p>
      {images.length > 0 && (
        <>
          <p className="font-mono text-13 text-text-muted">
            <span className="text-text">—— video (prikker)</span> · <span className="text-warning">- - canvas (firkanter)</span>
          </p>
          <div className="flex gap-2">
            {images.map((i) =>
              i.url === "" ? null : (
                // eslint-disable-next-line @next/next/no-img-element -- an in-memory blob URL, never optimised
                <img key={i.check.pct} src={i.url} alt={`Skelet ved ${i.check.pct} % af klippet`} className="w-1/3 rounded-tile" />
              ),
            )}
          </div>
        </>
      )}
      <pre className="whitespace-pre-wrap break-words font-mono text-12 text-text">{log}</pre>
      <div className="flex items-center gap-3">
        <button type="button" className={DARK_BTN} onClick={() => void copy()}>
          Kopiér log
        </button>
        <span role="status" className="font-sans text-13 text-text-muted">
          {copied}
        </span>
      </div>
    </section>
  );
}
