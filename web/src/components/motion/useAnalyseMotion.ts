"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import { barDelay, dashLength, lineDelay, marksDelay, polylineLength, type Pt, SPARK } from "@/lib/analyse-motion";
import { DUR, EASE_EMBER, REDUCED_MOTION } from "@/lib/motion";

import { useTabEntry } from "../TabShell";

const ANALYSE = 2;
/**
 * The entry motion starts once the shell's card stack has settled (DUR.stack = 440 ms, + 20), never
 * inside it (the reference's 180 ms put the bars' first frames into the stack's slide).
 */
const ENTRY_DELAY = DUR.stack + 20;
/** Frames to wait for a responsive chart to measure itself and draw its lines (then play without them). */
const MAX_WAIT_FRAMES = 30;

/**
 * The markup contract (AnalyseCharts sets it):
 * - `[data-motion-bars]`: a strip; each child with `data-mark` is a bar, in x order (barsIn()).
 * - `[data-motion-group]`: one chart or e1RM panel; its lines draw, then its marks fade in (sparksIn()).
 * - `.motion-line`: a recharts Line whose curve draws (its dots are marks), or an SVG polyline that draws.
 * - `.motion-marks` / `[data-motion-marks]`: dots and markers that fade in after their group's lines.
 */
const LINE = "g.motion-line path.recharts-line-curve, polyline.motion-line";
const MARKS = "g.motion-line .recharts-line-dots, g.motion-marks, [data-motion-marks]";

const reduced = () => window.matchMedia(REDUCED_MOTION).matches;

/** A line's dash length: its own length, and for a stretched polyline also its on-screen length. */
function lengthOf(el: SVGGeometryElement): number {
  const user = el.getTotalLength();
  if (!(el instanceof SVGPolylineElement)) return dashLength(user);
  const svg = el.ownerSVGElement;
  const vb = svg?.viewBox.baseVal;
  if (svg == null || vb == null || vb.width === 0 || vb.height === 0) return dashLength(user);
  const box = svg.getBoundingClientRect();
  const pts: Pt[] = Array.from(el.points, (p) => [p.x, p.y] as const);
  return dashLength(user, polylineLength(pts, box.width / vb.width, box.height / vb.height));
}

type Planned = { readonly el: Element; readonly keyframes: Keyframe[]; readonly options: KeyframeAnimationOptions };

/** barsIn() on every strip in `root`: scaleY 0 → 1 from the bottom, 600 ms, the stagger capped per strip (barDelay). No layout reads. */
function planBars(root: HTMLElement, base: number, out: Planned[]) {
  for (const strip of root.querySelectorAll<HTMLElement>("[data-motion-bars]")) {
    const bars = Array.from(strip.children).filter((b): b is HTMLElement => b instanceof HTMLElement && b.dataset.mark !== undefined);
    bars.forEach((bar, i) => {
      // fill "backwards": scaled to 0 while it waits, nothing left once it has run (or is cancelled).
      out.push({
        el: bar,
        keyframes: [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
        options: { duration: DUR.bars, delay: barDelay(i, bars.length, base), easing: EASE_EMBER, fill: "backwards" },
      });
    });
  }
}

/**
 * sparksIn() on every group in `root`: each line draws by stroke-dashoffset over 800 ms at
 * 200 + 120·i ms (i = its place among the page's lines), then the group's marks fade in.
 * `elapsed`: ms since the motion's start (waiting for a chart to draw), taken off each delay.
 * Every length is read here, before any animation is created, so no write forces a layout.
 */
function planLines(root: HTMLElement, base: number, elapsed: number, out: Planned[]) {
  const page = root.closest("[data-tab-page]") ?? document.body;
  const all = Array.from(page.querySelectorAll<SVGGeometryElement>(LINE));
  const groups = Array.from(page.querySelectorAll("[data-motion-group]"));
  for (const group of root.querySelectorAll<HTMLElement>("[data-motion-group]")) {
    let last: number | null = null;
    for (const line of group.querySelectorAll<SVGGeometryElement>(LINE)) {
      const i = all.indexOf(line);
      last = Math.max(last ?? i, i);
      const l = lengthOf(line);
      out.push({
        el: line,
        keyframes: [
          { strokeDasharray: `${l} ${l}`, strokeDashoffset: `${l}` },
          { strokeDasharray: `${l} ${l}`, strokeDashoffset: "0" },
        ],
        options: { duration: SPARK.draw, delay: lineDelay(i, base) - elapsed, easing: EASE_EMBER, fill: "backwards" },
      });
    }
    const turn = Math.max(0, groups.indexOf(group));
    for (const marks of group.querySelectorAll<Element>(MARKS)) {
      out.push({
        el: marks,
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        options: { duration: SPARK.marksFade, delay: marksDelay(last, turn, base) - elapsed, easing: EASE_EMBER, fill: "backwards" },
      });
    }
  }
}

/** The writes, after every read. */
function play(plans: readonly Planned[], out: Animation[]) {
  for (const p of plans) out.push(p.el.animate(p.keyframes, p.options));
}

/**
 * Analyse's entry motion for one chart (slice motion-analyse; DESIGN.md Motion, reference barsIn()
 * / sparksIn()): plays when Analyse is entered (useTabEntry) and when the chart mounts after first
 * paint (the Cykel/Styrke switch, a soft navigation); never on first paint, a reload, under reduced
 * motion, or while Analyse is not the active tab. "Mounted after first paint" = `ready` (useHydrated)
 * was already true on the first render: a hydrating component reads false there, also when its
 * Suspense boundary hydrates after the shell, so first paint never animates. WAAPI on the rendered
 * DOM with nothing kept after the end, so a re-render or resize never leaves a bar scaled or a line dashed; taps and readouts
 * work throughout. Leaving the tab or a new entry lands a running motion at once.
 *
 * A null leaf, not a hook in the chart: it reads the tab-entry context, so a tab change re-renders
 * only this leaf, never the chart (as a hook it re-rendered every recharts chart on each tab change:
 * 80-170 ms of rAF work at 4x CPU). Render it at the same place in both branches of the chart
 * (skeleton and content), so it mounts with the chart's first render.
 * `root`: the element carrying the markup contract. `ready`: useHydrated(), the chart's DOM is rendered (not its skeleton).
 */
export function AnalyseMotion({ root, ready }: { readonly root: RefObject<HTMLElement | null>; readonly ready: boolean }): null {
  const [mountedLate] = useState(ready);
  const entry = useTabEntry(ANALYSE);
  const away = useTabEntry(0) + useTabEntry(1);
  const seenEntry = useRef(entry);
  const playedMount = useRef(false);

  useEffect(() => {
    if (!ready) return undefined;
    const el = root.current;
    let base: number | null = null;
    if (seenEntry.current !== entry) {
      seenEntry.current = entry;
      base = ENTRY_DELAY;
    } else if (mountedLate && !playedMount.current) {
      base = 0;
    }
    playedMount.current = true;
    if (base === null || el === null || reduced()) return undefined;
    if (el.closest("[data-tab-page]")?.hasAttribute("data-active") === false) return undefined;

    const running: Animation[] = [];
    let frame = 0;
    const t0 = performance.now();
    const hasGroups = el.querySelector("[data-motion-group]") !== null;
    // A responsive recharts chart draws after it has measured itself: its lines may not be there yet.
    const drawn = () => el.querySelector(LINE) !== null || el.querySelector(MARKS) !== null;
    const plans: Planned[] = [];
    planBars(el, base, plans);
    if (hasGroups && drawn()) {
      // One pass: every read (the lines' lengths), then every write.
      planLines(el, base, 0, plans);
      play(plans, running);
    } else {
      play(plans, running);
      const wait = (n: number) => {
        if (drawn() || n >= MAX_WAIT_FRAMES) {
          const lines: Planned[] = [];
          planLines(el, base, performance.now() - t0, lines);
          play(lines, running);
          return;
        }
        frame = requestAnimationFrame(() => wait(n + 1));
      };
      if (hasGroups) frame = requestAnimationFrame(() => wait(1));
    }
    return () => {
      cancelAnimationFrame(frame);
      for (const a of running) a.cancel();
      // A mount motion cancelled here (StrictMode's dev double effect) may play on the next run; an
      // inactive page returns before playing, so leaving the tab never replays it.
      if (base === 0) playedMount.current = false;
    };
  }, [root, ready, entry, away, mountedLate]);

  return null;
}
