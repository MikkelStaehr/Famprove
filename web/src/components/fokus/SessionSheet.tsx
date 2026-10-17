"use client";

import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { type SheetDot, type SheetRun, sheetRowSentence } from "@/lib/fokus-view";
import { DUR, EASE_EMBER, REDUCED_MOTION } from "@/lib/motion";

/** §15: a release past this share of the sheet's height, or a flick faster than this, closes. */
const CLOSE_SHARE = 0.25;
const FLICK_PX_PER_MS = 0.5;
const SCRIM_OPACITY = 0.55;

type Props = {
  readonly runs: readonly SheetRun[];
  readonly done: number;
  readonly total: number;
  /** Slide up on mount (a tap opened it); false when the page loads with it open (nothing animates on first paint). */
  readonly animateIn: boolean;
  /** The sheet's top edge in px from the viewport top (12px under the rest strip or the top bar; R4), measured on open. */
  readonly measureTop: () => number;
  /** Called once the sheet is gone; `jumpTo` = the row tapped (a jump), else null. */
  readonly onClosed: (jumpTo: number | null) => void;
  /** Filled with the sheet's close, so a tap on the rest strip (outside the sheet) can close it. */
  readonly closeRef: RefObject<(() => void) | null>;
};

/**
 * The session sheet (fokus-sheet.md §6–§17; DESIGN.md Part B "Bottom sheet"): the session's runs
 * in tap order, a tap on a run jumps there. A modal dialog over a scrim; the rest strip stays live
 * above the scrim (the screen lifts it). Closes by Luk, scrim, Escape, the back gesture and a swipe
 * down; slides with EASE_EMBER, not at all under reduced motion.
 */
export function SessionSheet({ runs, done, total, animateIn, measureTop, onClosed, closeRef }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const closing = useRef(false);
  const pushed = useRef(false);
  const drag = useRef<{ y0: number; t0: number; y: number; t: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const reduced = () => window.matchMedia(REDUCED_MOTION).matches;

  /** Slides the sheet (and fades the scrim) from where it is to `to` (0 open, 1 closed) of its height. */
  const slide = useCallback((from: number, to: number, ms: number): Promise<void> => {
    const el = sheet.current;
    const sc = scrim.current;
    if (el === null || reduced() || ms === 0) return Promise.resolve();
    const opts = { duration: ms, easing: EASE_EMBER, fill: "forwards" } as const;
    sc?.animate([{ opacity: SCRIM_OPACITY * (1 - from) }, { opacity: SCRIM_OPACITY * (1 - to) }], opts);
    return el
      .animate([{ transform: `translateY(${from * 100}%)` }, { transform: `translateY(${to * 100}%)` }], opts)
      .finished.then(() => undefined)
      .catch(() => undefined);
  }, []);

  const close = useCallback(
    (jumpTo: number | null, fromPop = false) => {
      if (closing.current) return;
      closing.current = true;
      // §15: closing any other way than the back gesture pops the entry the open pushed.
      if (!fromPop && pushed.current) window.history.back();
      pushed.current = false;
      const el = sheet.current;
      const at = el === null ? 0 : currentShare(el);
      void slide(at, 1, DUR.sheetClose).then(() => onClosed(jumpTo));
    },
    [slide, onClosed],
  );

  useEffect(() => {
    closeRef.current = () => close(null);
    return () => {
      closeRef.current = null;
    };
  }, [close, closeRef]);

  // Open: slide up (a tap) or be there at once (first paint), focus the title, push one history entry.
  useLayoutEffect(() => {
    if (sheet.current !== null) sheet.current.style.top = `${measureTop()}px`;
    if (animateIn) void slide(1, 0, DUR.sheetOpen);
    title.current?.focus();
    window.history.pushState({ fokusSheet: true }, "");
    pushed.current = true;
    const onPop = () => close(null, true);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // Runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // §16: Escape closes; Tab cycles inside the sheet.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(null);
      return;
    }
    if (e.key !== "Tab" || sheet.current === null) return;
    const items = [...sheet.current.querySelectorAll<HTMLElement>("button, [tabindex='-1']")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === title.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // §15: a swipe down on the grabber, the header, or the list at its top follows the finger.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (closing.current || e.button !== 0) return;
    const inList = list.current?.contains(e.target as Node) ?? false;
    if (inList && (list.current?.scrollTop ?? 0) > 0) return;
    drag.current = { y0: e.clientY, t0: e.timeStamp, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheet.current;
    if (d === null || el === null || d.id !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - d.y0);
    if (!dragging && dy < 6) return;
    if (!dragging) {
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.y = e.clientY;
    d.t = e.timeStamp;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = `translateY(${dy}px)`;
    if (scrim.current !== null) scrim.current.style.opacity = String(SCRIM_OPACITY * (1 - dy / el.offsetHeight));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (d === null || el === null || !dragging) return;
    setDragging(false);
    const dy = Math.max(0, e.clientY - d.y0);
    const speed = (e.clientY - d.y) / Math.max(1, e.timeStamp - d.t);
    const share = dy / el.offsetHeight;
    el.style.transform = "";
    if (scrim.current !== null) scrim.current.style.opacity = "";
    if (share > CLOSE_SHARE || speed > FLICK_PX_PER_MS) {
      if (!reduced()) el.style.transform = `translateY(${share * 100}%)`;
      close(null);
      return;
    }
    // Settles back (snaps under reduced motion).
    void slide(share, 0, DUR.sheetClose);
  };

  return (
    <>
      <div ref={scrim} aria-hidden="true" onClick={() => close(null)} className="fixed inset-0 z-40 bg-black" style={{ opacity: SCRIM_OPACITY }} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fokus-sheet-title"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[30rem] flex-col rounded-t-hero border-t border-border bg-card px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 touch-none rounded-[2px] bg-shade-1" />
        <div className="flex shrink-0 touch-none items-center gap-3 pt-2">
          <h2 id="fokus-sheet-title" ref={title} tabIndex={-1} className="min-w-0 flex-1 font-sans text-18 font-semibold">
            Hele sessionen
          </h2>
          <span className="font-mono text-12 text-text-muted tabular-nums">
            {done}/{total}
          </span>
          <button type="button" aria-label="Luk" onClick={() => close(null)} className="-mr-2.5 flex size-11 items-center justify-center rounded-full text-text active:opacity-85">
            <Icon name="x" size={20} />
          </button>
        </div>
        <p className="shrink-0 text-13 text-text-muted">Tryk på en øvelse for at tage den nu. Rækkefølgen ændres kun i dag.</p>
        <p aria-hidden="true" className="mt-3 shrink-0 text-right font-mono text-11 text-text-muted uppercase">
          I dag
        </p>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SheetRows runs={runs} onJump={(row) => close(row)} />
        </div>
      </div>
    </>
  );
}

/** How far down the sheet is now, as a share of its height (0 open). */
function currentShare(el: HTMLElement): number {
  const t = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return el.offsetHeight === 0 ? 0 : Math.min(1, Math.max(0, t.m42 / el.offsetHeight));
}

/** §10: the rows in tap order; a superset pair shares one group with the rail and the indent. */
function SheetRows({ runs, onJump }: { readonly runs: readonly SheetRun[]; readonly onJump: (row: number) => void }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const next = runs[i + 1];
    if (run.partner !== null && next !== undefined && next.row === run.partner) {
      out.push(
        <div key={`pair-${run.row}`} role="group" aria-label={`Superset: ${run.name} og ${next.name}`} className="border-b border-border">
          <div className="ml-1 border-l-2 border-text pl-3">
            <Row run={run} onJump={onJump} last={false} />
            <Row run={next} onJump={onJump} last />
          </div>
        </div>,
      );
      i += 1;
    } else {
      out.push(
        <div key={run.row} className="border-b border-border last:border-b-0">
          <Row run={run} onJump={onJump} last />
        </div>,
      );
    }
  }
  return <div className="flex flex-col">{out}</div>;
}

function Row({ run, onJump, last }: { readonly run: SheetRun; readonly onJump: (row: number) => void; readonly last: boolean }) {
  const muted = run.finished;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-col">
          <span className={`font-sans text-16 font-medium [overflow-wrap:anywhere] ${muted ? "text-text-muted" : "text-text"}`}>{run.name}</span>
          {run.under !== null && <span className="font-sans text-13 text-text-muted">{run.under}</span>}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {run.dots.map((d, k) => (
            <Dot key={k} state={d} />
          ))}
        </span>
      </span>
      {run.current && <span className="shrink-0 font-mono text-11 text-text uppercase">Nu</span>}
      {run.kg !== null && (
        <span className={`shrink-0 font-mono text-16 tabular-nums ${muted ? "text-text-muted" : "text-text"} ${run.kg.italic ? "italic" : ""}`}>{run.kg.text}</span>
      )}
      {run.canJump && <Icon name="chevron-right" size={16} className="text-text-muted" />}
    </>
  );
  const base = `flex min-h-14 w-full items-center gap-3 py-2.5 text-left ${last ? "" : "border-b border-border"}`;
  if (run.canJump) {
    return (
      <button type="button" onClick={() => onJump(run.row)} className={`${base} active:opacity-85`}>
        <span className="sr-only">{sheetRowSentence(run)}</span>
        <span aria-hidden="true" className="contents">
          {body}
        </span>
      </button>
    );
  }
  return (
    <div className={`${base} ${run.current ? "-mx-2 rounded-[14px] bg-raised px-2" : ""}`}>
      <span className="sr-only">{sheetRowSentence(run)}</span>
      <span aria-hidden="true" className="contents">
        {body}
      </span>
    </div>
  );
}

/** §10: shape carries the state (done disc, skipped ring with a minus bar, now ring with a centre dot, upcoming ring). */
function Dot({ state }: { readonly state: SheetDot }) {
  if (state === "done") return <span className="block size-2.5 rounded-full bg-text" />;
  const ring = state === "now" ? "border-text" : "border-text-muted";
  return (
    <span className={`relative block size-2.5 rounded-full border-[1.5px] ${ring}`}>
      {state === "now" && <span className="absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-text" />}
      {state === "skipped" && <span className="absolute top-1/2 left-1/2 h-[1.5px] w-1.5 -translate-1/2 bg-text-muted" />}
    </span>
  );
}
