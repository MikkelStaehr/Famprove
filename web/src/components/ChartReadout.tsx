"use client";

import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Readout, readoutText, tipLeft } from "@/lib/chart-readout";

/**
 * DESIGN.md "Charts: interaction": one selection per chart card. Touch and pen (pointerType !==
 * "mouse") tap or drag the marker and read the values in the readout row; a mouse hovers and gets
 * a floating tooltip that never covers the point; ←/→ step, Esc clears. A tap outside clears.
 */
export type PickMode = "touch" | "mouse" | "key";
export type Pick = { readonly index: number; readonly mode: PickMode };

export function useChartPick(opts: {
  readonly count: number;
  readonly startIndex: number; // where ←/→ start (the latest point / current week)
  readonly indexAt: (clientX: number, box: DOMRect) => number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<Pick | null>(null);

  // A tap outside the plot clears a touch or keyboard selection (a mouse clears on leave).
  useEffect(() => {
    if (pick === null || pick.mode === "mouse") return;
    const onDown = (e: globalThis.PointerEvent) => {
      // composedPath, not contains: the tap that made the selection re-renders the chart, so its
      // target node may already be detached when this (synchronously added) listener sees it.
      if (ref.current !== null && !e.composedPath().includes(ref.current)) setPick(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pick]);

  const at = (e: PointerEvent<HTMLDivElement>, press: boolean) => {
    const touch = e.pointerType !== "mouse";
    if (touch && !press && e.buttons === 0) return; // a pen hovering: no selection
    const index = opts.indexAt(e.clientX, e.currentTarget.getBoundingClientRect());
    if (index === null) {
      if (!touch) setPick(null);
      return;
    }
    setPick({ index, mode: touch ? "touch" : "mouse" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setPick(null);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const from = pick?.index ?? opts.startIndex;
    const step = pick === null ? 0 : e.key === "ArrowLeft" ? -1 : 1;
    setPick({ index: Math.max(0, Math.min(opts.count - 1, from + step)), mode: "key" });
  };

  const plotProps = {
    ref,
    tabIndex: 0,
    role: "group" as const,
    style: { touchAction: "pan-y" } as const,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => at(e, true),
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => at(e, false),
    onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") setPick((p) => (p?.mode === "mouse" ? null : p));
    },
    onKeyDown,
    onBlur: () => setPick((p) => (p?.mode === "key" ? null : p)),
  };
  return { pick, plotProps };
}

/** The value shown only after `ms` of quiet, at most once per `ms` (the aria-live text while dragging). */
function useThrottled(text: string, ms = 150): string {
  const [shown, setShown] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + ms - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      setShown(text);
    }, wait);
    return () => clearTimeout(t);
  }, [text, ms]);
  return shown;
}

/** Fixed min-height: line 1 and facts at text-14, the cells line at text-16 (rem, so 200 % text may grow it). */
export function readoutMinHeight(lines: number, cells: boolean): string {
  const small = cells ? lines - 1 : lines;
  return `calc(${small} * var(--text-14) * var(--text-14--line-height) + ${cells ? 1 : 0} * var(--text-16) * var(--text-16--line-height))`;
}

function Triangle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0" fill="currentColor">
      <path d="M6 1 11 11H1Z" />
    </svg>
  );
}

/** Line 1, the cells (swatch, muted label, value) and the facts. */
export function ReadoutLines({ readout, swatch }: { readonly readout: Readout; readonly swatch?: (key: string) => ReactNode }) {
  return (
    <>
      <p className={`text-14 ${readout.muted === true ? "text-text-muted" : "font-semibold text-text"}`}>{readout.head}</p>
      {readout.cells.length > 0 && (
        <p className="flex flex-wrap gap-x-4 text-16 font-semibold tabular-nums">
          {readout.cells.map((c) => (
            <span key={c.key} className="flex items-center gap-2 whitespace-nowrap">
              {swatch?.(c.key)}
              <span className="font-normal text-text-muted">{c.label}</span>
              <span className={c.warning === true ? "flex items-center gap-1 text-warning" : "text-text"}>
                {c.warning === true && <Triangle />}
                {c.value}
              </span>
            </span>
          ))}
        </p>
      )}
      {readout.facts.map((f, i) => (
        <p key={i} className="text-14 text-text-muted tabular-nums">
          {f}
        </p>
      ))}
    </>
  );
}

/** The readout row: under the x labels, fixed min-height, aria-live (throttled to 150 ms). */
export function ChartReadout({
  readout,
  lines,
  cells,
  swatch,
}: {
  readonly readout: Readout;
  readonly lines: number;
  readonly cells: boolean; // the chart has a cells line (line 2 at text-16)
  readonly swatch?: (key: string) => ReactNode;
}) {
  const live = useThrottled(readoutText(readout));
  return (
    <div className="flex flex-col" style={{ minHeight: readoutMinHeight(lines, cells) }}>
      <div aria-hidden="true" className="flex flex-col">
        <ReadoutLines readout={readout} swatch={swatch} />
      </div>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

/** Same min-height as the row, for the pre-hydration skeleton (nothing jumps on hydrate). */
export function ReadoutSpace({ lines, cells }: { readonly lines: number; readonly cells: boolean }) {
  return <div aria-hidden="true" style={{ minHeight: readoutMinHeight(lines, cells) }} />;
}

/**
 * Mouse only: the floating tooltip, top-aligned 8px under the plot top, 12px right of the marker;
 * flipped left of it when it would cross the plot's right edge (measured before paint).
 */
export function PointerTip({
  readout,
  left,
  rightInset,
  swatch,
}: {
  readonly readout: Readout;
  readonly left: string; // the marker's CSS x inside the plot box
  readonly rightInset: number; // px between the plot's right edge and the box's
  readonly swatch?: (key: string) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (el === null || box === null || box === undefined) return;
    el.style.left = `calc(${left} + 12px)`;
    const marker = el.offsetLeft - 12;
    el.style.left = `${tipLeft(marker, el.offsetWidth, box.clientWidth - rightInset)}px`;
    el.style.visibility = "visible";
  });
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute top-2 z-10 flex w-max max-w-72 flex-col gap-0.5 rounded-control border border-border bg-surface px-3 py-2 shadow-card"
      style={{ left: `calc(${left} + 12px)`, visibility: "hidden" }}
    >
      <ReadoutLines readout={readout} swatch={swatch} />
    </div>
  );
}

/** The 1px --text marker, the full height of the plot stack (aria-hidden). */
export function Marker({ left, bottom }: { readonly left: string; readonly bottom: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 z-[2] w-px bg-text"
      style={{ left: `calc(${left} - 0.5px)`, bottom }}
    />
  );
}

