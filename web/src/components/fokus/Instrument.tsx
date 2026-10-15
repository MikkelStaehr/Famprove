import type { ReactNode } from "react";

import { Icon } from "../icons";

/** Parts shared by the Fokus views (DESIGN.md Part B Ember, design/specs/reset-fokus.md). */

/**
 * Buttons (DESIGN.md Part B "Buttons", design/specs/button-type.md): every label is `text-button`
 * (Geist Mono 15/500, uppercase, 0.04em), icons 18px, gap 8px, --radius-button. Pressed: opacity
 * 0.85, instantly. Focus: the global 2px --focus ring at 2px, on --bg.
 *
 * The one light button: only the done (Udført, and the warm-up's done). Full width, 56px,
 * --inverse-bg fill, --inverse-text label, no border.
 */
export const PRIMARY_BOX =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-button border-0 bg-inverse-bg px-4 text-button text-inverse-text active:opacity-85";
// Its dock: pinned to the bottom of the screen while the view is taller than it (the one action
// stays reachable at 390 x 844 without scrolling); in place when the view is short. The page colour
// behind it, with a 12px fade from transparent above it, hides content scrolling under the button;
// the safe-area inset clears the home indicator. No grain (Ember).
export const PRIMARY_DOCK =
  "sticky bottom-0 z-10 bg-bg pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-linear-to-b before:from-transparent before:to-bg";
/** A dark button (everything but the done): --card fill, 1px --text-muted border (5.02:1 on --card, 5.44:1 on --bg), --text label. */
export const OUTLINED = "rounded-button border border-text-muted bg-card text-button text-text active:opacity-85";
/** A full-width dark button in the primary's place (Tilbage til Træning): 56px, same dock. */
export const DARK_BOX = `flex min-h-14 w-full items-center justify-center gap-2 px-4 ${OUTLINED}`;
/** Afslut and Fortryd: compact dark buttons, padding 0 14, 44px tall. */
export const COMPACT_SECONDARY = `inline-flex min-h-11 shrink-0 items-center gap-2 px-3.5 ${OUTLINED}`;
/** Fokus captions (reset-fokus.md §1): MonoCaption at 13px, read at arm's length. */
export const CAPTION = "font-mono text-13 font-normal text-text-muted uppercase";
/** Spring over: a dark bordered button (button-type.md B4, no longer a text link), 44px tall. */
export const SKIP_BUTTON = `inline-flex min-h-11 items-center justify-center px-4 ${OUTLINED}`;

/** A 1px divider in --border (never an outline, [A5]). */
export function Hairline({ className = "" }: { readonly className?: string }) {
  return <hr aria-hidden="true" className={`h-px border-0 bg-border ${className}`} />;
}

/** The check icon (icons.tsx path), 1.5px line; the caller sizes it (20px on the primary). */
export function CheckIcon({ className }: { readonly className: string }) {
  return <Icon name="check" className={className} />;
}

/** The arrow-right icon, 18px (Part B Buttons), 1.5px line. */
export function ArrowIcon() {
  return <Icon name="arrow-right" size={18} />;
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
