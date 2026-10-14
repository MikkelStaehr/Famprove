import type { ReactNode } from "react";

/** Parts shared by the Fokus views (DESIGN.md Part B Ember, design/specs/reset-fokus.md). */

/**
 * The view's one primary action (reset-fokus.md §4): the InverseCard button inverted for a dark
 * page. Full width, 56px, --radius-button, --inverse-bg fill, --inverse-text Geist 20/500 label,
 * 20px icons. Pressed: opacity 0.85, instantly. Focus: the global 2px --focus ring at 2px, on --bg.
 */
export const PRIMARY_BOX =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-button border-0 bg-inverse-bg px-4 font-sans text-20 font-medium text-inverse-text active:opacity-85";
// Its dock: pinned to the bottom of the screen while the view is taller than it (the one action
// stays reachable at 390 x 844 without scrolling); in place when the view is short. The page colour
// behind it, with a 12px fade from transparent above it, hides content scrolling under the button;
// the safe-area inset clears the home indicator. No grain (Ember).
export const PRIMARY_DOCK =
  "sticky bottom-0 z-10 bg-bg pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-linear-to-b before:from-transparent before:to-bg";
/** A secondary control (reset-fokus.md §4): --card fill, 1px --text-muted border (≥ 3:1), Geist 16/500, --radius-button. */
export const OUTLINED = "rounded-button border border-text-muted bg-card font-sans text-16 font-medium text-text active:opacity-85";
/** Afslut and Fortryd (reset-fokus.md §4): compact secondary buttons, padding 0 14, 44px tall. */
export const COMPACT_SECONDARY = `inline-flex min-h-11 shrink-0 items-center gap-2 px-3.5 ${OUTLINED}`;
/** Fokus captions (reset-fokus.md §1): MonoCaption at 13px, read at arm's length. */
export const CAPTION = "font-mono text-13 font-normal text-text-muted uppercase";
/** Spring over (round 4): a centred muted underlined text link, 44px target, no box. */
export const MUTED_LINK =
  "min-h-11 px-4 font-sans text-16 font-normal text-text-muted underline decoration-1 underline-offset-4";
/** An ink text action (Hele noten): Geist 500, underlined 1px at 4px. */
export const INK_LINK = "min-h-11 font-sans text-16 font-medium text-text underline decoration-1 underline-offset-4";

/** A 1px divider in --border (never an outline, [A5]). */
export function Hairline({ className = "" }: { readonly className?: string }) {
  return <hr aria-hidden="true" className={`h-px border-0 bg-border ${className}`} />;
}

/** The check icon (icons.tsx path), 1.5px line; the caller sizes it (20px on the primary). */
export function CheckIcon({ className }: { readonly className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** The arrow-right icon (icons.tsx path), 20px, 1.5px line. */
export function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M5 12h14M13 6l6 6-6 6" />
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
