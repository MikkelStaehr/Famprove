/**
 * /load's desktop grid (design/specs/reset-belastning.md §8, DESIGN.md Part A "Layout: phone and
 * desktop"), shared by app/load/page.tsx and its loading.tsx so the skeleton never jumps. Below lg:
 * one column in phone order, 12px apart. From lg: 3 columns × 384, gap 24. Placement only; DOM
 * order never changes.
 */
// Col 1 stacks form, tiles and the grid card (rows 1–2 auto, the grid card spans 3–5); cols 2–3 stack
// the curve (rows 1–3), the bars (row 4) and the week list (row 5). Row 3 takes the curve's extra
// height, and the grid card starts in it, so col 1 has no hole under the tiles and the week list
// follows the bars directly.
export const LOAD_GRID = "flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:grid-rows-[auto_auto_1fr_auto_auto] lg:items-start lg:gap-6";

export const LOAD_PLACE = {
  form: "lg:col-start-1 lg:row-start-1",
  tiles: "lg:col-start-1 lg:row-start-2",
  curve: "lg:col-span-2 lg:col-start-2 lg:row-span-3 lg:row-start-1",
  grid: "lg:col-start-1 lg:row-span-3 lg:row-start-3",
  bars: "lg:col-span-2 lg:col-start-2 lg:row-start-4",
  week: "lg:col-span-2 lg:col-start-2 lg:row-start-5",
} as const;
