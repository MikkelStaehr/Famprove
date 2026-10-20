"use client";

import { type RefObject, useCallback, useEffect, useReducer, useRef, useState } from "react";

import { saveClip } from "@/app/actions";
import { CAMERA_CONSTRAINTS } from "@/lib/video/constraints";
import { type ClipIndex, type ClipIndexEntry, type ClipNameStack, interrupted } from "@/lib/video/index-store";
import { indexedDbClipIndex } from "@/lib/video/index-store-browser";
import { pickRecorderType, recorderOptions, type RecorderType } from "@/lib/video/mime";
import type { ClipFiles, ClipWriter } from "@/lib/video/opfs";
import { opfsClipFiles, persistStorage } from "@/lib/video/opfs-browser";
import { type AfbrudtReason, clipEntryFor, clipOutcome, IDLE, lowSpace, openGuard, recReducer, type RecState, saveInputOf, stopThenDone } from "@/lib/video/recording";
import { MAX_DURATION_S } from "@/lib/video/clips";
import type { LiftFamily } from "@/lib/video/auto-clip";
import { analyseClip } from "@/lib/video/auto-run";
import { browserAutoDeps } from "@/lib/video/auto-run-browser";
import { browserStore, recordIfSaved } from "@/lib/video/auto-version";
import { type FokusAutoPhase, fokusAutoLine, isOutcome } from "@/lib/video/auto-lines";
import type { SetRef } from "@/lib/set-taps";

/** DEV_FIXTURE=recording / camera-denied: the strip's state without a camera (nothing opens, nothing is written). */
export type VideoFixture = "recording" | "camera-denied" | null;

/** What the automatic clip needs of the recorded set (clip-auto): the lift's family and the reps it should hold. */
export type ClipLift = { readonly family: LiftFamily; readonly expected: number | null };

/**
 * clip-auto §1's slot after Stop: reserved from Stop (phase null = no line yet), then the phase or
 * the outcome; `spoken` is the status region's text, set once at the start and once at the outcome.
 */
export type AutoSlot = { readonly id: string; readonly phase: FokusAutoPhase | null; readonly spoken: string };

/** The recording fixture's frozen time (spec §Fixtures). */
const FIXTURE_ELAPSED_S = 48;
const TIMESLICE_MS = 1000;

type Live = {
  readonly id: string;
  readonly ref: SetRef;
  readonly type: RecorderType;
  readonly stream: MediaStream;
  readonly recorder: MediaRecorder;
  readonly writer: ClipWriter;
  readonly entry: ClipIndexEntry;
  readonly lift: ClipLift;
  startedAt: number | null;
  chain: Promise<void>;
  stopped: Promise<void>;
  limit: ReturnType<typeof setTimeout> | undefined;
  failed: AfbrudtReason | null;
  /** The recorder's stop event came (every chunk has arrived before it). */
  stopFired: boolean;
};

export type ClipRecorder = {
  readonly state: RecState;
  /** null until checked on the phone: absent = no Optag (§2). */
  readonly available: boolean | null;
  readonly lowSpace: boolean;
  /** Seconds since `start` (frozen at 0:48 under the fixture). */
  readonly elapsed: number;
  readonly fixture: boolean;
  readonly previewRef: RefObject<HTMLVideoElement | null>;
  /** clip-auto §1: the rest card's slot after a recorded set; null = no slot. */
  readonly auto: AutoSlot | null;
  readonly optag: (ref: SetRef, names: ClipNameStack, date: string, sessionNo: number, lift: ClipLift, onStarted: () => void) => void;
  /** Stop = done: the recorder first, then `done`, then the file and the row. */
  readonly stopAndDone: (done: () => void) => void;
  /** Annullér, Afslut, background: the clip is kept as afbrudt, no done. */
  readonly abort: (reason: AfbrudtReason) => Promise<void>;
  /** The done after a 15:00 stop saves the clip with the set. */
  readonly saveLimited: () => void;
  readonly clear: () => void;
};

function releaseTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

function supported(): RecorderType | null {
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return null;
  if (typeof navigator.storage?.getDirectory !== "function") return null;
  if (typeof MediaRecorder === "undefined") return null;
  return pickRecorderType((t) => MediaRecorder.isTypeSupported(t));
}

/** The Fokus record control's camera, recorder, files and index (video-record.md §4–§14). */
export function useClipRecorder(allowed: boolean, fixture: VideoFixture, autoFixture: FokusAutoPhase | null = null): ClipRecorder {
  const [state, dispatch] = useReducer(
    recReducer,
    fixture === "recording" ? { kind: "recording", startedAt: 0 } : fixture === "camera-denied" ? { kind: "denied" } : IDLE,
  );
  const [available, setAvailable] = useState<boolean | null>(fixture !== null ? true : null);
  const [low, setLow] = useState(false);
  const [elapsed, setElapsed] = useState(fixture === "recording" ? FIXTURE_ELAPSED_S : 0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const live = useRef<Live | null>(null);
  const files = useRef<ClipFiles | null>(null);
  const index = useRef<ClipIndex | null>(null);
  const persisted = useRef(false);
  const limited = useRef<{ readonly entry: ClipIndexEntry; readonly durationS: number } | null>(null);
  const opening = useRef(openGuard());
  // clip-auto: the slot (DEV_FIXTURE=clip-*: an injected phase, nothing runs) and the run's abort.
  const [auto, setAuto] = useState<AutoSlot | null>(() =>
    autoFixture === null ? null : { id: "fixture", phase: autoFixture, spoken: fokusAutoLine(autoFixture).spoken },
  );
  const autoRun = useRef<AbortController | null>(null);
  const stopAuto = () => {
    autoRun.current?.abort();
    autoRun.current = null;
  };

  const ix = (): ClipIndex => (index.current ??= indexedDbClipIndex());
  const fs = (): ClipFiles => (files.current ??= opfsClipFiles());

  const sync = useCallback(async (entry: ClipIndexEntry, durationS: number): Promise<boolean> => {
    let ok = false;
    try {
      const r = await saveClip(saveInputOf(entry, durationS));
      ok = r.ok;
    } catch {
      ok = false;
    }
    await ix().put({ ...entry, state: "done", durationS, synced: ok });
    return ok;
  }, []);

  /**
   * clip-auto §1: after a saved Stop, the one analysis. A new Optag and leaving Fokus abort it
   * (nothing written); a hidden page does not (no camera is involved). The line follows the run
   * only while the slot is still this clip's (a done clears the line, the run carries on).
   */
  const analyse = useCallback(async (l: Live, durationS: number) => {
    if (l.type.ext !== "mp4") return; // WebM: no analysis and no line
    stopAuto();
    const ctrl = new AbortController();
    autoRun.current = ctrl;
    const show = (phase: FokusAutoPhase) =>
      setAuto((a) => {
        if (a === null || a.id !== l.id || ctrl.signal.aborted) return a;
        const spoken = isOutcome(phase) || a.spoken === "" ? fokusAutoLine(phase).spoken : a.spoken;
        return { id: l.id, phase, spoken };
      });
    let blob: Blob | null = null;
    try {
      blob = await fs().read(l.id, l.type.ext);
    } catch {
      blob = null;
    }
    if (ctrl.signal.aborted || blob === null) return;
    const meta = { ext: l.type.ext, durationS, family: l.lift.family, expected: l.lift.expected };
    const out = await analyseClip(l.id, blob, meta, { signal: ctrl.signal, onProgress: show, deps: browserAutoDeps });
    recordIfSaved(browserStore(), l.id, out); // else the library pickup re-runs a clip Fokus analysed with ALGO_VERSION
    if (autoRun.current === ctrl) autoRun.current = null;
    if (out.kind === "clipped") show({ kind: "clipped", inS: out.inS, outS: out.outS });
    else if (out.kind === "low_confidence" || out.kind === "failed") show({ kind: out.kind });
  }, []);

  // §2/§3/§13 on load: capabilities, space, a blocked camera; the index's leftovers.
  useEffect(() => {
    if (!allowed || fixture !== null) return;
    const type = supported();
    void Promise.resolve().then(() => setAvailable(type !== null)); // checked on the phone, after hydration
    if (type === null) return;
    void navigator.storage.estimate?.().then((e) => setLow(lowSpace(e)), () => undefined);
    void navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        if (p.state === "denied") dispatch({ type: "denied" });
      })
      .catch(() => undefined);
    void (async () => {
      try {
        const all = await ix().all();
        for (const e of interrupted(all, live.current?.id ?? null)) await ix().put(e);
        // A failed insert is retried on the next open (§8); the index marks it unsynced.
        for (const e of all) if (e.state === "done" && e.synced === false && e.durationS !== null) await sync(e, e.durationS);
      } catch {
        // an unreadable index never blocks Fokus
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [allowed, fixture]);


  // The running time (§5): a tick a second while recording; frozen under the fixture.
  useEffect(() => {
    if (state.kind !== "recording" || fixture !== null) return;
    const id = setInterval(() => setElapsed((Date.now() - state.startedAt) / 1000), 250);
    return () => clearInterval(id);
  }, [state, fixture]);

  // The live preview: the stream on the strip's <video> once it is shown.
  useEffect(() => {
    const v = previewRef.current;
    if (state.kind === "recording" && v !== null && live.current !== null && v.srcObject !== live.current.stream) {
      v.srcObject = live.current.stream;
      void v.play().catch(() => undefined);
    }
  }, [state]);

  const duration = (l: Live): number => (l.startedAt === null ? 0 : Math.min(MAX_DURATION_S, (Date.now() - l.startedAt) / 1000));

  const stopRecorder = (l: Live): Promise<void> => {
    clearTimeout(l.limit);
    if (l.recorder.state !== "inactive") l.recorder.stop();
    releaseTracks(l.stream);
    return l.stopped;
  };

  const abort = useCallback(async (reason: AfbrudtReason) => {
    const l = live.current;
    if (l === null) {
      // The camera is still opening: the stream is released when it arrives, nothing is recorded.
      if (opening.current.cancel()) dispatch({ type: "abort", reason, durationS: 0 });
      return;
    }
    live.current = null;
    const d = duration(l);
    releaseTracks(l.stream); // within 1 s of hidden: synchronously, before any await
    dispatch({ type: "abort", reason: l.failed ?? reason, durationS: d });
    try {
      await stopRecorder(l);
      await l.chain;
      if (d < 1) {
        await l.writer.abort();
        await ix().remove(l.id);
      } else {
        await l.writer.close();
        await ix().put({ ...l.entry, state: "afbrudt", durationS: d });
      }
    } catch {
      // the entry stays "recording" and becomes afbrudt on the next open
    }
  }, []);

  const optag = useCallback(
    (ref: SetRef, names: ClipNameStack, date: string, sessionNo: number, lift: ClipLift, onStarted: () => void) => {
      if (fixture !== null || autoFixture !== null) return; // §16: no camera opens under the fixtures
      // clip-auto §1.7: a new Optag cancels the previous clip's run (nothing written) and its line.
      stopAuto();
      setAuto(null);
      const type = supported();
      if (type === null) return;
      dispatch({ type: "optag" });
      const attempt = opening.current.begin();
      void (async () => {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        } catch (error) {
          if (attempt.cancelled) return;
          opening.current.settle(attempt);
          dispatch(error instanceof DOMException && error.name === "NotAllowedError" ? { type: "denied" } : { type: "abort", reason: "failed", durationS: 0 });
          return;
        }
        if (!opening.current.keep(attempt, stream)) return; // unmounted, hidden or cancelled meanwhile
        try {
          if (!persisted.current) {
            persisted.current = true;
            void persistStorage().catch(() => false);
          }
          const id = crypto.randomUUID();
          const writer = await fs().create(id, type.ext);
          const entry = clipEntryFor({ id, ref, date, sessionNo, ext: type.ext, names, recordedAt: new Date().toISOString() });
          await ix().put(entry);
          if (!opening.current.keep(attempt, stream)) {
            await writer.abort();
            await ix().remove(id);
            return;
          }
          opening.current.settle(attempt);
          const recorder = new MediaRecorder(stream, recorderOptions(type));
          let resolveStopped: () => void = () => undefined;
          const stopped = new Promise<void>((r) => {
            resolveStopped = r;
          });
          const l: Live = { id, ref, type, stream, recorder, writer, entry, lift, startedAt: null, chain: Promise.resolve(), stopped, limit: undefined, failed: null, stopFired: false };
          live.current = l;
          recorder.ondataavailable = (e) => {
            if (e.data.size === 0) return;
            l.chain = l.chain.then(() => writer.append(e.data)).catch((err: unknown) => {
              l.failed = err instanceof DOMException && err.name === "QuotaExceededError" ? "space" : "failed";
              void abort(l.failed);
            });
          };
          recorder.onstop = () => {
            l.stopFired = true;
            resolveStopped();
          };
          recorder.onerror = () => {
            l.failed = "failed";
            void abort("failed");
          };
          recorder.onstart = () => {
            l.startedAt = Date.now();
            setElapsed(0);
            dispatch({ type: "started", at: l.startedAt });
            navigator.vibrate?.(30);
            onStarted();
            // §9: at 15:00 the recorder stops by itself; the clip is saved with the set's done.
            l.limit = setTimeout(() => {
              if (live.current !== l) return;
              live.current = null;
              const d = duration(l);
              dispatch({ type: "limit", durationS: d });
              void stopRecorder(l)
                .then(() => l.chain)
                .then(() => l.writer.close())
                .then(() => {
                  const done = { ...l.entry, state: "done" as const, durationS: d };
                  limited.current = { entry: done, durationS: d };
                  return ix().put(done);
                })
                .catch(() => undefined);
            }, MAX_DURATION_S * 1000);
          };
          recorder.start(TIMESLICE_MS);
        } catch {
          releaseTracks(stream);
          live.current = null;
          if (attempt.cancelled) return;
          opening.current.settle(attempt);
          dispatch({ type: "abort", reason: "failed", durationS: 0 });
        }
      })();
    },
    [fixture, autoFixture, abort],
  );

  const stopAndDone = useCallback(
    (done: () => void) => {
      const l = live.current;
      if (l === null) {
        done();
        return;
      }
      live.current = null;
      const d = duration(l);
      dispatch({ type: "stop" });
      // §1: the slot is reserved from Stop (no line until saveClip succeeds; WebM never gets one).
      if (l.type.ext === "mp4") setAuto({ id: l.id, phase: null, spoken: "" });
      void stopThenDone({
        stopRecorder: () => stopRecorder(l),
        done,
        finalise: async () => {
          try {
            // After the 800 ms cap a late chunk would land after close(): it is dropped, and the clip
            // that misses it is kept as afbrudt with §14's error line, never saved short as done.
            const whole = l.stopFired;
            l.recorder.ondataavailable = null;
            await l.chain;
            await l.writer.close();
            const failed = clipOutcome(whole, l.failed);
            if (failed !== null) {
              await ix().put({ ...l.entry, state: "afbrudt", durationS: d });
              dispatch({ type: "abort", reason: failed, durationS: d });
              return;
            }
            await ix().put({ ...l.entry, state: "done", durationS: d });
            dispatch({ type: "stopped", durationS: d });
            if (await sync(l.entry, d)) void analyse(l, d);
          } catch {
            dispatch({ type: "abort", reason: "failed", durationS: d });
          }
        },
      });
    },
    [sync, analyse],
  );

  const saveLimited = useCallback(() => {
    const l = limited.current;
    if (l === null) return;
    limited.current = null;
    dispatch({ type: "stopped", durationS: l.durationS });
    void sync(l.entry, l.durationS);
  }, [sync]);

  // §14: hidden while recording stops at once (the tracks synchronously), no done, kept as afbrudt.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && (live.current !== null || opening.current.pending())) void abort("background");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [abort]);

  // Unmount (Afslut, Minimér, back, a tab switch): the camera is released, the clip kept as afbrudt,
  // and a running analysis is aborted (clip-auto: nothing written; Træning's pickup takes it).
  useEffect(
    () => () => {
      stopAuto();
      void abort("cancel");
    },
    [abort],
  );

  return {
    state,
    available: allowed ? available : false,
    lowSpace: low,
    elapsed,
    fixture: fixture !== null,
    previewRef,
    auto,
    optag,
    stopAndDone,
    abort,
    saveLimited,
    clear: () => {
      dispatch({ type: "clear" });
      // §1 Lifetime: the next done hides the line; the run carries on and lands in Optagelser.
      if (autoFixture === null) setAuto(null);
    },
  };
}
