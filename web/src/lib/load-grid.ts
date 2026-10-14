/**
 * /load's desktop grid (design/specs/reset-belastning.md §8, DESIGN.md Part A "Layout: phone and
 * desktop"), shared by app/load/page.tsx and its loading.tsx so the skeleton never jumps. Below lg:
 * one column in phone order, 12px apart. From lg: 3 columns × 384, gap 24. Placement only; DOM
 * order never changes.
 */
// Row 2 takes the curve's extra height, so the tiles sit right under the form card.
export const LOAD_GRID = "flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:grid-rows-[auto_1fr_auto_auto] lg:items-start lg:gap-6";

export const LOAD_PLACE = {
  form: "lg:col-start-1 lg:row-start-1",
  tiles: "lg:col-start-1 lg:row-start-2",
  curve: "lg:col-span-2 lg:col-start-2 lg:row-span-2 lg:row-start-1",
  grid: "lg:col-start-1 lg:row-start-3",
  bars: "lg:col-span-2 lg:col-start-2 lg:row-start-3",
  week: "lg:col-span-2 lg:col-start-2 lg:row-start-4",
} as const;
