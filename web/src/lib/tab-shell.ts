/**
 * The swipeable tab shell's rules (slice motion-shell; docs/decisions/tab-shell.md, design/specs/motion-shell.md,
 * reference design/reference/famprove-motion.html). Pure: no DOM; unit-tested with `node --test`.
 * Position p is a fractional page index: 0 Træning, 1 Belastning, 2 Analyse.
 */

export const TABS = [
  { path: "/train", label: "Træning" },
  { path: "/load", label: "Belastning" },
  { path: "/analyse", label: "Analyse" },
] as const;
export const TAB_COUNT = TABS.length;

/** Drag and release (the reference's numbers, the user's request). */
export const SWIPE = {
  lockPx: 10, // |dx| before the drag locks horizontal
  lockRatio: 1.3, // and |dx| > 1.3 |dy|
  edgePx: 22, // starts this close to either screen edge belong to the system back gesture
  releaseShare: 0.22, // of the width: change page
  releaseVelocity: 0.45, // px/ms: change page
  rubber: 0.3, // past the first / last page
} as const;

/** The card stack (DESIGN.md tokens --radius-stack, --radius-sink, --shadow-stack; a scrim, not brightness). */
export const STACK = {
  sinkScale: 0.08,
  sinkShift: 0.08, // of the width
  scrim: 0.55,
  radiusStack: "var(--radius-stack)", // the left corners of the page sliding in on top
  radiusSink: "var(--radius-sink)", // x t, the page sinking back
  shadow: "var(--shadow-stack)",
} as const;

/** The document title for a path: the tab's label, "Analyse · Styrke" on the Styrke section. */
export function tabTitle(pathname: string): string {
  if (pathname === "/analyse/styrke" || pathname.startsWith("/analyse/styrke/")) return "Analyse · Styrke";
  return TABS[tabIndex(pathname)].label;
}

/** The tab a path belongs to; any other path (never reached inside the shell) is Træning. */
export function tabIndex(pathname: string): number {
  const i = TABS.findIndex((t) => pathname === t.path || pathname.startsWith(`${t.path}/`));
  return i === -1 ? 0 : i;
}

export type PageStyle = {
  readonly transform: string;
  readonly borderRadius: string;
  readonly boxShadow: string;
  readonly visibility: "visible" | "hidden";
  readonly scrim: number; // the black scrim's opacity over the page
  readonly zIndex: number;
};

/**
 * Page `i` at position `p` (d = i - p). To the right of p (d >= 0) it slides in on top:
 * translateX(d x 100 %), 24px left corners and the shadow while it is partly in. To the left
 * (t = min(1, -d)) it sinks back: scale(1 - 0.08 t), translateX(-8 % t), the scrim 0.55 t and a
 * 26 t px radius. Hidden once fully off. Percentages, so no width is needed (server render = client).
 */
export function pageStyle(i: number, p: number): PageStyle {
  const d = i - p;
  const zIndex = i + 1;
  if (d >= 0) {
    const partly = d > 0.001;
    return {
      transform: `translate3d(${round(d * 100)}%,0,0)`,
      borderRadius: partly ? `${STACK.radiusStack} 0 0 ${STACK.radiusStack}` : "0",
      boxShadow: partly && d < 1 ? STACK.shadow : "none",
      visibility: d >= 0.999 ? "hidden" : "visible",
      scrim: 0,
      zIndex,
    };
  }
  const t = Math.min(1, -d);
  return {
    transform: `translate3d(${round(-t * STACK.sinkShift * 100)}%,0,0) scale(${round(1 - STACK.sinkScale * t)})`,
    borderRadius: `calc(${STACK.radiusSink} * ${round(t)})`,
    boxShadow: "none",
    visibility: -d >= 0.999 ? "hidden" : "visible",
    scrim: round(STACK.scrim * t),
    zIndex,
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** "x" once the drag is horizontal, "y" once it is a scroll (the drag is dropped), null while undecided. */
export function dragLock(dx: number, dy: number): "x" | "y" | null {
  if (Math.abs(dx) > SWIPE.lockPx && Math.abs(dx) > SWIPE.lockRatio * Math.abs(dy)) return "x";
  if (Math.abs(dy) > SWIPE.lockPx) return "y";
  return null;
}

/** A start within SWIPE.edgePx of either edge is the system's (Android's back gesture). */
export function edgeStart(x: number, viewportWidth: number): boolean {
  return x < SWIPE.edgePx || x > viewportWidth - SWIPE.edgePx;
}

/** p while dragging `dx` px from page `index`: rubber band 0.3 past either end. */
export function dragPosition(index: number, dx: number, width: number): number {
  const p = index - dx / Math.max(1, width);
  if (p < 0) return p * SWIPE.rubber;
  if (p > TAB_COUNT - 1) return TAB_COUNT - 1 + (p - (TAB_COUNT - 1)) * SWIPE.rubber;
  return p;
}

/** The page a release lands on: past 22 % of the width or faster than 0.45 px/ms, else back. */
export function releaseTarget(index: number, dx: number, ms: number, width: number): number {
  const v = dx / Math.max(1, ms);
  const next =
    dx < -width * SWIPE.releaseShare || v < -SWIPE.releaseVelocity
      ? index + 1
      : dx > width * SWIPE.releaseShare || v > SWIPE.releaseVelocity
        ? index - 1
        : index;
  return Math.max(0, Math.min(TAB_COUNT - 1, next));
}
