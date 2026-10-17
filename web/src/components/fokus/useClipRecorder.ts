"use client";

import { type RefObject, useCallback, useEffect, useReducer, useRef, useState } from "react";

import { saveClip } from "@/app/actions";
import { CAMERA_CONSTRAINTS } from "@/lib/video/constraints";
import { type ClipIndex, type ClipIndexEntry, type ClipNameStack, interrupted } from "@/lib/video/index-store";
import { indexedDbClipIndex } from "@/lib/video/index-store-browser";
import { pickRecorderType, type RecorderType } from "@/lib/video/mime";
import type { ClipFiles, ClipWriter } from "@/lib/video/opfs";
import { opfsClipFiles, persistStorage } from "@/lib/video/opfs-browser";
import { type AfbrudtReason, clipOutcome, IDLE, lowSpace, openGuard, recReducer, type RecState, stopThenDone } from "@/lib/video/recording";
import { MAX_DURATION_S } from "@/lib/video/clips";
import type { SetRef } from "@/lib/set-taps";

/** DEV_FIXTURE=recording / camera-denied: the strip's state without a camera (nothing opens, nothing is written). */
export type VideoFixture = "recording" | "camera-denied" | null;

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
  readonly optag: (ref: SetRef, names: ClipNameStack, date: string, sessionNo: number, onStarted: () => void) => void;
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
export function useClipRecorder(allowed: boolean, fixture: VideoFixture): ClipRecorder {
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

  const ix = (): ClipIndex => (index.current ??= indexedDbClipIndex());
  const fs = (): ClipFiles => (files.current ??= opfsClipFiles());

  const sync = useCallback(async (entry: ClipIndexEntry, durationS: number) => {
    const { date, sessionNo, row, set } = entry.setKey;
    let ok = false;
    try {
      const r = await saveClip({ id: entry.id, date, sessionNo, row, set, durationS });
      ok = r.ok;
    } catch {
      ok = false;
    }
    await ix().put({ ...entry, state: "done", durationS, synced: ok });
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
    (ref: SetRef, names: ClipNameStack, date: string, sessionNo: number, onStarted: () => void) => {
      if (fixture !== null) return; // §16: no camera opens under the fixtures
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
          const entry: ClipIndexEntry = {
            id,
            setKey: { date, sessionNo, row: ref.row, set: ref.set },
            ext: type.ext,
            recordedAt: new Date().toISOString(),
            durationS: null,
            starred: false,
            starSynced: true,
            state: "recording",
            synced: false,
            names,
          };
          await ix().put(entry);
          if (!opening.current.keep(attempt, stream)) {
            await writer.abort();
            await ix().remove(id);
            return;
          }
          opening.current.settle(attempt);
          const recorder = new MediaRecorder(stream, { mimeType: type.mimeType });
          let resolveStopped: () => void = () => undefined;
          const stopped = new Promise<void>((r) => {
            resolveStopped = r;
          });
          const l: Live = { id, ref, type, stream, recorder, writer, entry, startedAt: null, chain: Promise.resolve(), stopped, limit: undefined, failed: null, stopFired: false };
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
    [fixture, abort],
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
            await sync(l.entry, d);
          } catch {
            dispatch({ type: "abort", reason: "failed", durationS: d });
          }
        },
      });
    },
    [sync],
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

  // Unmount (Afslut, a tab switch): the camera is released, the clip kept as afbrudt.
  useEffect(() => () => void abort("cancel"), [abort]);

  return {
    state,
    available: allowed ? available : false,
    lowSpace: low,
    elapsed,
    fixture: fixture !== null,
    previewRef,
    optag,
    stopAndDone,
    abort,
    saveLimited,
    clear: () => dispatch({ type: "clear" }),
  };
}
