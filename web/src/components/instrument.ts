/**
 * Shared Instrument classes (DESIGN.md Part B Revision 5) for the restyled screens. Fokus keeps its
 * own copies in components/fokus/Instrument.tsx (same values).
 */

/** The screen's one primary action: an ink slab, full width, 56px, radius 0, label --bg Inter 500 24px. */
export const PRIMARY =
  "flex min-h-14 w-full items-center justify-center gap-3 border-0 bg-text px-4 font-sans text-24 font-medium text-bg active:opacity-80";

/** A secondary action (Prøv igen, Gem igen): 1px --text-muted outline ([A5]), 44px, Inter 500 16px, radius 0. */
export const SECONDARY =
  "inline-flex min-h-11 items-center justify-center border border-text-muted px-4 font-sans text-16 font-medium text-text";
