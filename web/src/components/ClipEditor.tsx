"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { setClipRange } from "@/app/actions";
import {
  applyKey,
  type ClipRangeS,
  type Handle,
  handleLimits,
  keyMove,
  moveHandle,
  rangeErrorLine,
  type SetClipRangeResult,
  startRange,
  type StoredRange,
} from "@/lib/video/clip-range";
import type { VideoClipRow } from "@/lib/video/clips";
import { formatSeconds } from "@/lib/video/cut-lines";

const BTN = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const DARK_BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-track px-4 font-sans text-14 font-medium text-text disabled:opacity-50 ${BTN}`;
const PRIMARY = `inline-flex min-h-11 min-w-[7.5rem] items-center justify-center rounded-full bg-inverse-bg px-5 font-sans text-14 font-medium text-inverse-text disabled:opacity-50 ${BTN}`;

/** setClipRange that never throws: a thrown call (the network) is a failed one. */
export async function sendClipRange(id: string, range: StoredRange): Promise<SetClipRangeResult | { readonly ok: false; readonly reason: "network" }> {
  try {
    return await setClipRange({ id, inS: range.inS, outS: range.outS });
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** The video's own operations, outside the component (they mutate the element, never React state). */
function seekVideo(v: HTMLVideoElement, t: number): void {
  if (typeof v.fastSeek === "function") v.fastSeek(t);
  else v.currentTime = t;
}

function rewindVideo(v: HTMLVideoElement, t: number): void {
  v.pause();
  v.currentTime = t;
}

function startVideo(v: HTMLVideoElement, t: number, onFail: () => void): void {
  v.currentTime = t;
  void v.play().catch(onFail);
}

function nowMs(): number {
  return performance.now();
}

type Failure = "invalid" | "range" | "not_found" | "not_allowed" | "failed" | "network";

/**
 * The clip editor (slice clip-handles, design/specs/clip-handles.md §2–3): two handles on a strip,
 * the readout, Gem klip / Afspil klip / Fortryd / Fjern klip. Every rAF is cancelled on unmount; the
 * drag uses pointer capture on the handle itself, so no window listener is added.
 */
export function ClipEditor({
  clip,
  video,
  onSaved,
  onRemoved,
  onCancel,
}: {
  readonly clip: VideoClipRow;
  /** The player's video (null in the fixture: no file). */
  readonly video: RefObject<HTMLVideoElement | null>;
  readonly onSaved: (range: StoredRange) => void;
  /** Fjern klip landed; `old` is the user's range it removed (for the status line's Fortryd). */
  readonly onRemoved: (old: ClipRangeS) => void;
  readonly onCancel: () => void;
}) {
  const duration = clip.durationS;
  const [range, setRange] = useState<ClipRangeS>(() => startRange(clip));
  const [saving, setSaving] = useState<"save" | "remove" | null>(null);
  const [failure, setFailure] = useState<{ readonly reason: Failure; readonly retry: StoredRange } | null>(null);
  const [playT, setPlayT] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const startHandle = useRef<HTMLDivElement>(null);
  const drag = useRef<Handle | null>(null);
  const seekRaf = useRef<number | null>(null);
  const seekTo = useRef<number | null>(null);
  const playRaf = useRef<number | null>(null);
  const hasUserRange = clip.clipInS !== null && clip.clipOutS !== null;

  useEffect(() => {
    startHandle.current?.focus(); // the button that opened it is gone (the editor replaces the row)
    const v = video.current;
    const seeks = seekRaf;
    const plays = playRaf;
    return () => {
      if (seeks.current !== null) cancelAnimationFrame(seeks.current);
      if (plays.current !== null) cancelAnimationFrame(plays.current);
      v?.pause();
    };
  }, [video]);

  /** §2 Preview: seeks the video to t, at most once per frame. */
  function seek(t: number) {
    seekTo.current = t;
    if (seekRaf.current !== null) return;
    seekRaf.current = requestAnimationFrame(() => {
      seekRaf.current = null;
      const v = video.current;
      const at = seekTo.current;
      if (v === null || at === null) return;
      seekVideo(v, at);
    });
  }

  function stopPlay(r: ClipRangeS = range) {
    if (playRaf.current !== null) cancelAnimationFrame(playRaf.current);
    playRaf.current = null;
    const v = video.current;
    if (v !== null) rewindVideo(v, r.inS);
    setPlayT(null);
  }

  /** §2 Afspil klip: in → out once, then stops at in. Without a video (fixture) the playhead runs on the clock. */
  function play() {
    if (playT !== null) {
      stopPlay();
      return;
    }
    const r = range;
    const v = video.current;
    const t0 = nowMs();
    if (v !== null) startVideo(v, r.inS, () => stopPlay(r));
    setPlayT(r.inS);
    const tick = () => {
      const t = v !== null ? v.currentTime : r.inS + (nowMs() - t0) / 1000;
      // duration_s is rounded to 0.1 s, so out may sit past the file's real end: ended stops it too.
      if (t >= r.outS || (v !== null && v.ended)) {
        stopPlay(r);
        return;
      }
      setPlayT(t);
      playRaf.current = requestAnimationFrame(tick);
    };
    playRaf.current = requestAnimationFrame(tick);
  }

  function move(next: ClipRangeS, handle: Handle) {
    if (playT !== null) stopPlay(next);
    setRange(next);
    seek(handle === "in" ? next.inS : next.outS);
  }

  function timeAt(clientX: number): number {
    const el = strip.current;
    if (el === null) return 0;
    const rect = el.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * duration;
  }

  function onPointerDown(handle: Handle, e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return; // the primary button or a touch only, never a right click
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = handle;
  }

  function onPointerMove(handle: Handle, e: PointerEvent<HTMLDivElement>) {
    if (drag.current !== handle) return;
    move(moveHandle(range, handle, timeAt(e.clientX), duration), handle);
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onKey(handle: Handle, e: KeyboardEvent<HTMLDivElement>) {
    const m = keyMove(e.key, e.shiftKey);
    if (m === null) return;
    e.preventDefault();
    move(applyKey(range, handle, m, duration), handle);
  }

  async function send(kind: "save" | "remove", values: StoredRange) {
    if (playT !== null) stopPlay();
    setSaving(kind);
    setFailure(null);
    const r = await sendClipRange(clip.id, values);
    setSaving(null);
    if (!r.ok) {
      setFailure({ reason: r.reason, retry: values });
      return;
    }
    const stored: StoredRange = r.inS === null || r.outS === null ? { inS: null, outS: null } : { inS: r.inS, outS: r.outS };
    if (kind === "remove" && clip.clipInS !== null && clip.clipOutS !== null) onRemoved({ inS: clip.clipInS, outS: clip.clipOutS });
    else onSaved(stored);
  }

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const handle = (h: Handle) => {
    const lim = handleLimits(h, range, duration);
    const now = h === "in" ? range.inS : range.outS;
    return (
      <div
        ref={h === "in" ? startHandle : undefined}
        role="slider"
        tabIndex={0}
        aria-label={h === "in" ? "Start" : "Slut"}
        aria-valuemin={lim.min}
        aria-valuemax={lim.max}
        aria-valuenow={now}
        aria-valuetext={formatSeconds(now)}
        aria-orientation="horizontal"
        className="group absolute top-0 flex h-12 w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center focus-visible:outline-none"
        style={{ left: pct(now) }}
        onPointerDown={(e) => onPointerDown(h, e)}
        onPointerMove={(e) => onPointerMove(h, e)}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onKeyDown={(e) => onKey(h, e)}
      >
        <span aria-hidden="true" className="block h-12 w-1 rounded-full bg-text group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-baseline justify-between font-mono text-15 text-text">
        <span>Start {formatSeconds(range.inS)}</span>
        <span className="text-text-muted">{formatSeconds(range.outS - range.inS)}</span>
        <span>Slut {formatSeconds(range.outS)}</span>
      </p>
      <div className="mx-2.5">
        <div ref={strip} className="relative h-12 rounded-card">
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-card">
            <span className="absolute inset-y-0 left-0 bg-track/50" style={{ width: pct(range.inS) }} />
            <span className="absolute inset-y-0 border-y-2 border-text bg-track" style={{ left: pct(range.inS), right: `calc(100% - ${pct(range.outS)})` }} />
            <span className="absolute inset-y-0 right-0 bg-track/50" style={{ left: pct(range.outS) }} />
            {playT !== null && <span className="absolute inset-y-0 w-0.5 bg-text-muted" style={{ left: pct(playT) }} />}
          </div>
          {handle("in")}
          {handle("out")}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={saving !== null} onClick={() => void send("save", range)}>
          {saving === "save" ? "Gemmer …" : "Gem klip"}
        </button>
        <button type="button" className={DARK_BTN} disabled={saving !== null} onClick={play}>
          {playT !== null ? "Stop" : "Afspil klip"}
        </button>
        <button type="button" className={DARK_BTN} disabled={saving !== null} onClick={onCancel}>
          Fortryd
        </button>
        {hasUserRange && (
          <button type="button" className={DARK_BTN} disabled={saving !== null} onClick={() => void send("remove", { inS: null, outS: null })}>
            Fjern klip
          </button>
        )}
      </div>
      <div role="status" className="font-sans text-13 text-text-muted">
        {failure !== null && (
          <span className="flex flex-wrap items-center gap-x-3">
            <span>
              <span aria-hidden="true" className="text-warning">
                ◆{" "}
              </span>
              {rangeErrorLine(failure.reason)}
            </span>
            {(failure.reason === "failed" || failure.reason === "network") && (
              <button type="button" className={`min-h-11 text-text underline underline-offset-4 ${BTN}`} onClick={() => void send(failure.retry.inS === null ? "remove" : "save", failure.retry)}>
                Prøv igen
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
