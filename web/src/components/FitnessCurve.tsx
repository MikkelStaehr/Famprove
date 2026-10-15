"use client";

import { type PointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { bracketGeometry, monoLabelWidth } from "@/lib/chart-marks";
import { buzz, curveShape, type CurveShape, curveYAt, morphFrame, shapeAt } from "@/lib/curve-motion";
import { curveReadout, nearestIndex } from "@/lib/chart-readout";
import { type BlockSpan, type ChartPoint, ctlBandArea } from "@/lib/dashboard-view";
import { addDays, dayNumber } from "@/lib/dates";
import type { IsoDate } from "@/lib/db/rows";
import { formatDate, formatDay } from "@/lib/format";
import { curveAnchors, type CurveRange, curveScale, curveWindow } from "@/lib/load-days";
import { monotonePath, monotoneSegments, type Segment, segmentsPath } from "@/lib/monotone-path";
import { DUR, EASE_EMBER, easeOutCubic, REDUCED_MOTION } from "@/lib/motion";

import { useMedia, useWidth } from "./chart-hooks";
import { ChartReadout, PLOT_FOCUS, useChartPick } from "./ChartReadout";
import { SegmentedControl } from "./SegmentedControl";
import { useTabEntry } from "./TabShell";

/**
 * Belastning's fitness curve (design/specs/reset-belastning.md §3, review-round.md §2/§3/§5): CTL only,
 * measured as a 2px --text line, the prognose 1.5px --text-muted dashed 3 4, the band after the block
 * as a 12 % area, a dashed gridline per y step (lib/load-days.ts curveScale), block brackets in a 16px strip, the ring on the last
 * measured day. Lines and band edges are monotone curves through weekly anchors (lib/load-days.ts
 * curveAnchors), so the line bends only at Sundays and the window ends. No today line. Nothing at
 * rest: a tap, click or key shows a 1px hairline and the readout. Python's values as-is; the only
 * arithmetic here is the drawing scale (date -> x, value -> y).
 */
type FitnessCurveProps = {
  readonly points: readonly ChartPoint[];
  readonly blocks: readonly BlockSpan[];
  readonly today: IsoDate;
  readonly lastActual: IsoDate;
  /** The sr sentences after the range sentence (today's values, prognose, blocks). */
  readonly summary: string;
};

const STRIP = 16;
const PAD_L = 2;
const PAD_R = 6;
const READOUT_LINES = 3; // date, cells, one fact (block · spænd)
const RANGES = [
  { value: "4U", label: "4U", ariaLabel: "4 uger" },
  { value: "12U", label: "12U", ariaLabel: "12 uger" },
  { value: "season", label: "Sæson" },
] as const;

export function FitnessCurve({ points, blocks, today, lastActual, summary }: FitnessCurveProps) {
  const [range, setRange] = useState<CurveRange>("12U");
  const seriesStart = points[0]?.date ?? today;
  const win = curveWindow(range, today, seriesStart);
  const shown = points.filter((p) => p.date >= win.from && p.date <= win.to);
  // "spænd" exactly when the band is drawn: Plot draws it from ≥ 2 band anchors.
  const band = curveAnchors(shown, (p) => ctlBandArea(p) !== null).band.length >= 2;
  const end = shown.findLast((p) => p.kind === "projected");
  const rangeSentence = `Fitness (CTL) i TSS/dag fra ${formatDay(win.from)} til ${formatDay(lastActual)}${
    end === undefined ? "" : `, og en anslået prognose til ${formatDay(end.date)}`
  }.`;
  return (
    <>
      <Plot points={shown} blocks={blocks} lastActual={lastActual} from={win.from} to={win.to} range={range} />
      <p className="sr-only" aria-live="polite">
        {rangeSentence} {summary}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SegmentedControl label="Periode" segments={RANGES} value={range} onChange={setRange} size="hero" />
        {/* fitness-round.md §1: only the prognose and, exactly when drawn, its band (no ring, no Blok). */}
        {(end !== undefined || band) && (
          <ul aria-label="Forklaring" className="flex flex-col items-end gap-1 font-mono text-11 text-text-muted sm:flex-row sm:items-center sm:gap-x-3">
            {end !== undefined && <li>- - - prognose</li>}
            {band && (
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="block size-2.5 bg-text-muted/12" />
                spænd
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}

type PlotProps = {
  readonly points: readonly ChartPoint[];
  readonly blocks: readonly BlockSpan[];
  readonly lastActual: IsoDate;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly range: CurveRange;
};

/** A running draw-in or morph: its frame, its timers, and how it lands on the static render. */
/** A running motion; `shape` (a morph only): what is on screen now, the next morph's start. */
type Motion = { raf: number; readonly timers: number[]; readonly finish: () => void; shape?: () => CurveShape };
/** What the last commit drew: the morph's start, and the static values a motion lands on. */
type Drawn = { readonly measured: readonly Segment[]; readonly prognose: readonly Segment[]; readonly ring: readonly [number, number] | null };

const reduced = () => window.matchMedia(REDUCED_MOTION).matches;

function Plot({ points, blocks, lastActual, from, to, range }: PlotProps) {
  const sm = useMedia("(min-width: 640px)");
  const lg = useMedia("(min-width: 1024px)");
  const [measure, width] = useWidth();
  const plotH = lg ? 280 : sm ? 200 : 180;
  const height = STRIP + plotH;

  const d0 = dayNumber(from);
  const d1 = dayNumber(to);
  const w = width ?? 0;
  const x = (date: IsoDate) => PAD_L + ((dayNumber(date) - d0) / Math.max(1, d1 - d0)) * (w - PAD_L - PAD_R);
  const values = points.flatMap((p) => {
    const b = ctlBandArea(p);
    return b === null ? [p.ctl] : [p.ctl, b[0], b[1]];
  });
  const scale = curveScale(values.length === 0 ? 0 : Math.min(...values), values.length === 0 ? 10 : Math.max(...values));
  const y = (v: number) => STRIP + ((scale.hi - v) / (scale.hi - scale.lo)) * plotH;

  const xs = points.map((p) => x(p.date));
  const latestIndex = points.findLastIndex((p) => p.kind === "actual");
  const { pick, plotProps: pickProps, clear: clearPick } = useChartPick({
    count: points.length,
    startIndex: Math.max(0, latestIndex),
    indexAt: (clientX, box) => (points.length === 0 ? null : nearestIndex(xs, clientX - box.left)),
    toggle: true,
    hover: false,
  });

  // review-round.md §3: no readout at rest; a selection shows that day's readout.
  const readouts = points.map((p) => curveReadout(p, blocks));
  const picked = pick === null ? undefined : points[pick.index];
  const readout = pick === null ? null : (readouts[pick.index] ?? null);

  // One monotone spline through the weekly anchors (measured, then the prognose's after the shared
  // last measured day), split there, so the dotted prognose leaves the line without a corner.
  const anchors = curveAnchors(points, (p) => ctlBandArea(p) !== null);
  const last = anchors.measured.at(-1);
  const curve = monotoneSegments([...anchors.measured, ...anchors.prognose.slice(anchors.measured.length > 0 ? 1 : 0)].map((p) => ({ x: x(p.date), y: y(p.ctl) })));
  const measuredSegs = curve.slice(0, Math.max(0, anchors.measured.length - 1));
  const prognoseSegs = curve.slice(Math.max(0, anchors.measured.length - 1));
  const measuredPath = segmentsPath(measuredSegs);
  const prognosePath = segmentsPath(prognoseSegs);
  const ring = last !== undefined && last.date === lastActual ? ([x(last.date), y(last.ctl)] as const) : null;
  // The scrub dot sits on the drawn line at the picked day (the reference's sDot).
  const dotX = picked === undefined ? null : x(picked.date);
  const dotY = dotX === null ? null : curveYAt(curve, dotX);

  // Motion (slice motion-load; DESIGN.md Motion; reference drawIn() / morphTo()). Imperative on the
  // static render's own nodes; every motion lands on exactly what React drew.
  const solidRef = useRef<SVGPathElement>(null);
  const fcastRef = useRef<SVGPathElement>(null);
  const bandRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const gridRef = useRef<SVGGElement>(null);
  const xlabRef = useRef<HTMLDivElement>(null);
  const motion = useRef<Motion | null>(null);
  const drawn = useRef<Drawn | null>(null);
  const stopMotion = useCallback(() => {
    const m = motion.current;
    if (m === null) return;
    motion.current = null;
    cancelAnimationFrame(m.raf);
    m.timers.forEach((t) => window.clearTimeout(t));
    m.finish();
  }, []);
  useEffect(() => stopMotion, [stopMotion]);

  // Range morph: 420 ms easeOutCubic, old and new points resampled and lerped; grid, labels,
  // brackets and band hidden meanwhile and faded back. Replaces the remount fade.
  const prevRange = useRef(range);
  useLayoutEffect(() => {
    if (prevRange.current === range) return;
    prevRange.current = range;
    clearPick(); // the picked index would point into another range's points (reference: hideScrub)
    const from = drawn.current;
    const onScreen = motion.current?.shape?.() ?? null; // a morph cut short: start from its frame
    // This commit is what React drew: a running motion stopped here lands on it, never on the last one.
    drawn.current = { measured: measuredSegs, prognose: prognoseSegs, ring };
    stopMotion();
    const solid = solidRef.current;
    const fcast = fcastRef.current;
    if (from === null || solid === null || fcast === null || reduced()) return;
    const a = onScreen ?? curveShape(from.measured, from.prognose);
    const b = curveShape(measuredSegs, prognoseSegs);
    let current: CurveShape = a;
    const faded = [gridRef.current, bandRef.current, xlabRef.current];
    for (const el of faded) {
      if (el === null) continue;
      el.style.transition = "none";
      el.style.opacity = "0";
    }
    const frame = (t: number) => {
      current = shapeAt(a, b, t);
      const f = morphFrame(a, b, t);
      solid.setAttribute("d", f.measured);
      fcast.setAttribute("d", f.prognose);
      if (ringRef.current !== null && f.ring !== null) {
        ringRef.current.setAttribute("cx", String(f.ring[0]));
        ringRef.current.setAttribute("cy", String(f.ring[1]));
      }
    };
    const m: Motion = {
      raf: 0,
      timers: [],
      shape: () => current,
      finish: () => {
        const now = drawn.current;
        solid.setAttribute("d", now === null ? "" : segmentsPath(now.measured));
        fcast.setAttribute("d", now === null ? "" : segmentsPath(now.prognose));
        if (ringRef.current !== null && now?.ring != null) {
          ringRef.current.setAttribute("cx", String(now.ring[0]));
          ringRef.current.setAttribute("cy", String(now.ring[1]));
        }
        for (const el of faded) {
          if (el === null) continue;
          el.style.transition = "opacity 200ms";
          el.style.opacity = "";
        }
      },
    };
    motion.current = m;
    let t0: number | null = null; // the first frame's time
    const step = (now: number) => {
      t0 ??= now;
      const t = easeOutCubic(Math.min(1, (now - t0) / DUR.morph));
      if (t >= 1) {
        stopMotion();
        return;
      }
      frame(t);
      m.raf = requestAnimationFrame(step);
    };
    frame(0);
    m.raf = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a range change only; the segments are this commit's
  }, [range, stopMotion, clearPick]);
  // After the morph check: what this commit drew (the next morph's start and every motion's landing).
  useLayoutEffect(() => {
    drawn.current = { measured: measuredSegs, prognose: prognoseSegs, ring };
  });

  // Draw-in on entering Belastning (never on first paint or reload): 180 ms after the entry, the
  // measured line draws over 900 ms, the ring fades in at 750 ms, the prognose and band at 850 ms.
  // Left mid-way (another tab entered) or a range change: it lands at once.
  const entry = useTabEntry(1);
  const away = useTabEntry(0) + useTabEntry(2);
  const seenEntry = useRef(entry);
  useEffect(() => {
    if (seenEntry.current === entry) return;
    seenEntry.current = entry;
    if (reduced()) return;
    stopMotion();
    const later = [fcastRef, bandRef, ringRef];
    const m: Motion = {
      raf: 0,
      timers: [],
      finish: () => {
        const solid = solidRef.current;
        if (solid !== null) {
          solid.style.transition = "";
          solid.style.strokeDasharray = "";
          solid.style.strokeDashoffset = "";
        }
        for (const r of later) {
          if (r.current === null) continue;
          r.current.style.transition = "";
          r.current.style.opacity = "";
        }
      },
    };
    motion.current = m;
    const at = (ms: number, f: () => void) => m.timers.push(window.setTimeout(f, ms));
    const fadeIn = (el: SVGElement | null, ms: number) => {
      if (el === null) return;
      el.style.transition = `opacity ${ms}ms`;
      el.style.opacity = "";
    };
    at(180, () => {
      const solid = solidRef.current;
      if (solid === null) return;
      const length = solid.getTotalLength();
      solid.style.transition = "none";
      solid.style.strokeDasharray = `${length}`;
      solid.style.strokeDashoffset = `${length}`;
      for (const r of later) {
        if (r.current === null) continue;
        r.current.style.transition = "none";
        r.current.style.opacity = "0";
      }
      void solid.getBoundingClientRect();
      solid.style.transition = `stroke-dashoffset ${DUR.draw}ms ${EASE_EMBER}`;
      solid.style.strokeDashoffset = "0";
      at(DUR.ringAt, () => fadeIn(ringRef.current, 250));
      at(DUR.prognoseAt, () => {
        fadeIn(fcastRef.current, 500);
        fadeIn(bandRef.current, 500);
      });
      at(DUR.prognoseAt + 500, stopMotion);
    });
  }, [entry, stopMotion]);
  useEffect(() => stopMotion(), [away, stopMotion]);

  // Scrub haptics (reference scrubAt()/buzz()): a 4 ms tick each time the picked day changes during
  // a drag. Not motion, so kept under reduced motion; no vibrate (iOS) is a no-op.
  const dragging = useRef(false);
  const lastKey = useRef<number | null>(null);
  const pickIndex = pick?.mode === "touch" ? pick.index : null;
  useEffect(() => {
    if (pickIndex === null || !dragging.current || pickIndex === lastKey.current) return;
    if (lastKey.current !== null) buzz(navigator);
    lastKey.current = pickIndex;
  }, [pickIndex]);
  const endDrag = () => {
    dragging.current = false;
  };
  const plotProps = {
    ...pickProps,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      lastKey.current = null;
      pickProps.onPointerDown(e);
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
  const bandPts = anchors.band;
  const edge = (side: 0 | 1) => bandPts.map((p) => ({ x: x(p.date), y: y(ctlBandArea(p)?.[side] ?? p.ctl) }));
  const bandPath = bandPts.length < 2 ? null : `${monotonePath(edge(1))}${monotonePath(edge(0).toReversed(), true)}Z`;

  return (
    <div ref={measure} className="flex flex-col gap-2">
      <div
        {...plotProps}
        aria-label="Fitness pr. dag. Brug piletasterne for at gå dag for dag."
        className={`relative w-full cursor-pointer rounded-control ${PLOT_FOCUS}`}
        style={{ ...plotProps.style, height }}
      >
        {width !== null && (
          <svg aria-hidden="true" width={w} height={height} className="block overflow-visible">
            <g ref={gridRef}>
            {scale.lines.map((v) => (
              <g key={v}>
                {v !== scale.lo && <line x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 4" />}
                <text x={w} y={y(v) - 4} textAnchor="end" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text-muted)">
                  {v}
                </text>
              </g>
            ))}
            {blocks.map((b) => (
              <Bracket key={b.name} block={b} x={x} from={from} to={to} />
            ))}
            </g>
            <line x1={0} x2={w} y1={STRIP + plotH - 0.5} y2={STRIP + plotH - 0.5} stroke="var(--axis)" strokeWidth={1} />
            {bandPath !== null && <path ref={bandRef} d={bandPath} fill="var(--text-muted)" fillOpacity={0.12} stroke="none" />}
            <path ref={fcastRef} d={prognosePath} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="3 4" />
            <path ref={solidRef} d={measuredPath} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
            {dotX !== null && (
              <line x1={dotX} x2={dotX} y1={STRIP} y2={STRIP + plotH} stroke="var(--text)" strokeWidth={1} />
            )}
            {ring !== null && <circle ref={ringRef} cx={ring[0]} cy={ring[1]} r={5} fill="var(--bg)" stroke="var(--text)" strokeWidth={2} />}
            {dotX !== null && dotY !== null && <circle cx={dotX} cy={dotY} r={4} fill="var(--text)" />}
          </svg>
        )}
      </div>
      <div ref={xlabRef}>
        <XLabels from={from} to={to} x={x} width={w} wide={sm} />
      </div>
      {width !== null && <ChartReadout readout={readout} all={readouts} lines={READOUT_LINES} cells swatch={swatch} />}
    </div>
  );
}

/** The Fitness cell's swatch: the 2px line. Træthed and Form have no mark on the curve. */
function swatch(key: string): ReactNode {
  return key === "ctl" ? <span aria-hidden="true" className="block h-0.5 w-3 bg-text" /> : null;
}

function Bracket({ block, x, from, to }: { readonly block: BlockSpan; readonly x: (d: IsoDate) => number; readonly from: IsoDate; readonly to: IsoDate }) {
  if (block.end < from || block.start > to) return null;
  const s = block.start < from ? from : block.start;
  const e = block.end > to ? to : block.end;
  const g = bracketGeometry(x(s), x(e), block.deloadStart === null ? null : x(block.deloadStart));
  if (g.width < 12) return null;
  const long = `Blok ${block.blockNo}`;
  const label = monoLabelWidth(long, 11) + 8 <= g.width ? long : monoLabelWidth(`B${block.blockNo}`, 11) + 8 <= g.width ? `B${block.blockNo}` : null;
  const by = 11.25;
  return (
    <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
      {g.solid !== null && <line x1={g.solid.x0} x2={g.solid.x1} y1={by} y2={by} />}
      {g.deload !== null && <line x1={g.deload.x0} x2={g.deload.x1} y1={by} y2={by} strokeDasharray="3 3" />}
      {g.ticks.map((t) => (
        <line key={t} x1={t} x2={t} y1={by} y2={by + 6} />
      ))}
      {label !== null && (
        <text x={g.mid} y={by - 3} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text-muted)" stroke="none">
          {label}
        </text>
      )}
    </g>
  );
}

/** Window start, the month starts that fit, window end: mono 11 muted, 4px under the plot. */
function XLabels({ from, to, x, width, wide }: { readonly from: IsoDate; readonly to: IsoDate; readonly x: (d: IsoDate) => number; readonly width: number; readonly wide: boolean }) {
  const gap = wide ? 72 : 64;
  const months: IsoDate[] = [];
  for (let d = `${from.slice(0, 7)}-01`; d <= to; d = addDays(`${d.slice(0, 7)}-28`, 4).slice(0, 7) + "-01") {
    if (d > from) months.push(d);
  }
  const kept: { date: IsoDate; anchor: "start" | "middle" | "end" }[] = [{ date: from, anchor: "start" }];
  let prev = x(from);
  for (const m of months) {
    const mx = x(m);
    if (mx - prev >= gap && x(to) - mx >= gap) {
      kept.push({ date: m, anchor: "middle" });
      prev = mx;
    }
  }
  kept.push({ date: to, anchor: "end" });
  return (
    <div aria-hidden="true" className="relative mt-0.5 h-lh font-mono text-11 text-text-muted tabular-nums">
      {width > 0 &&
        kept.map((k) => (
          <span
            key={k.date}
            className={`absolute top-0 whitespace-nowrap ${k.anchor === "middle" ? "-translate-x-1/2" : k.anchor === "end" ? "-translate-x-full" : ""}`}
            style={{ left: k.anchor === "end" ? width : k.anchor === "start" ? 0 : x(k.date) }}
          >
            {formatDate(k.date)}
          </span>
        ))}
    </div>
  );
}
