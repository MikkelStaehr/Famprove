import type { ReactNode } from "react";

/** Instrument parts shared by the Fokus views (DESIGN.md Part B, design/specs/fokus-instrument.md). */

/**
 * The view's one primary action (Part B single-accent, round 2): no fill, a 1px --accent rule
 * above, the label in Inter 500 24px --accent. With the rest scale's "now" tick, the only red.
 */
// Pinned to the bottom of the screen while the view is taller than it (Revision 2: air first, and
// the one action stays reachable at 390 x 844 without scrolling); in place when the view is short.
// The page colour behind it hides content scrolling under the red rule.
export const PRIMARY_FILL =
  "sticky bottom-0 z-10 flex min-h-16 w-full items-center justify-center gap-3 border-t border-accent bg-bg px-4 pb-[env(safe-area-inset-bottom)] font-grotesk text-24 font-medium text-accent active:opacity-70";
/** An outlined control ([A5]): 1px --text-muted, Inter 500. */
export const OUTLINED = "border border-text-muted font-grotesk text-16 font-medium text-text";
/** An ink text action (Afslut, Fortryd, Hele noten): Inter 500, underlined 1px at 4px. */
export const INK_LINK = "min-h-11 font-grotesk text-16 font-medium text-text underline decoration-1 underline-offset-4";

/** A 1px divider in --border (never an outline, [A5]). */
export function Hairline({ className = "" }: { readonly className?: string }) {
  return <hr aria-hidden="true" className={`h-px border-0 bg-border ${className}`} />;
}

export function CheckIcon({ className }: { readonly className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/** Stale / save-failed line (§6): an ink ◆ (SVG) and the words, never red. */
export function FokusWarning({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-16 text-text">
      <span className="flex h-lh shrink-0 items-center">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
          <path d="M8 1 15 8 8 15 1 8Z" />
        </svg>
      </span>
      <span>{children}</span>
    </p>
  );
}
