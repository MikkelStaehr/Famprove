/**
 * Shared button classes (DESIGN.md Part B Ember "Buttons elsewhere") for buttons on --card / --bg.
 * Fokus keeps its own copies in components/fokus/Instrument.tsx until its reset run.
 */

/** The screen's one primary action: --text fill, --inverse-text `text-button` label, 48px, --radius-button. */
export const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-button border-0 bg-text px-4 text-button text-inverse-text active:opacity-85";

/** A dark button (Prøv igen, Gem igen; Part B Buttons): --card fill, 1px --text-muted border (5.02:1), --text `text-button` label, 48px. */
export const SECONDARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-button border border-text-muted bg-card px-4 text-button text-text active:opacity-85";
