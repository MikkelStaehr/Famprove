/**
 * /load's desktop grid (design/specs/reset-belastning.md §8, DESIGN.md Part A "Layout: phone and
 * desktop"), shared by app/load/page.tsx and its loading.tsx so the skeleton never jumps. Below lg:
 * one column in phone order, 12px apart. From lg: 3 columns × 384, gap 24. Placement only; DOM
 * order never changes.
 */
// review-round.md §1: col 1 stacks form, tiles and the week card (rows 1–3; row 3 takes the curve's
// extra height); cols 2–3 hold the curve (rows 1–3). Row 4: the grid (col 1) and the bars (cols 2–3).
export const LOAD_GRID = "flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:grid-rows-[auto_auto_1fr_auto] lg:items-start lg:gap-6";

export const LOAD_PLACE = {
  form: "lg:col-start-1 lg:row-start-1",
  tiles: "lg:col-start-1 lg:row-start-2",
  week: "lg:col-start-1 lg:row-start-3",
  curve: "lg:col-span-2 lg:col-start-2 lg:row-span-3 lg:row-start-1",
  grid: "lg:col-start-1 lg:row-start-4",
  bars: "lg:col-span-2 lg:col-start-2 lg:row-start-4",
} as const;
