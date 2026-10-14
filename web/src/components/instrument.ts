/**
 * Shared button classes (DESIGN.md Part B Ember "Buttons elsewhere") for buttons on --card / --bg.
 * Fokus keeps its own copies in components/fokus/Instrument.tsx until its reset run.
 */

/** The screen's one primary action: --text fill, --inverse-text Geist 15/500 label, 48px, --radius-button. */
export const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-button border-0 bg-text px-4 font-sans text-15 font-medium text-inverse-text active:opacity-85";

/** A secondary action (Prøv igen, Gem igen): 1px --text-muted border (5.02:1), --text label, 48px. */
export const SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-button border border-text-muted px-4 font-sans text-15 font-medium text-text active:opacity-85";
