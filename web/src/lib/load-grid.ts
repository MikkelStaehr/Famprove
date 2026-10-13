/**
 * /load's desktop grid (design/specs/load.md §11a, DESIGN.md Part A "Layout: phone and desktop"),
 * shared by app/load/page.tsx and its loading.tsx so the skeleton never jumps. Below lg: one column
 * in phone order (hero → chart → week). From lg: hero and week in the rail (cols 1–4), the chart
 * in the main column (cols 5–12, rows 1–2). Placement only; DOM order never changes.
 */
export const LOAD_GRID = "flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6";

export const LOAD_PLACE = {
  hero: "lg:col-span-4 lg:col-start-1 lg:row-start-1",
  chart: "lg:col-span-8 lg:col-start-5 lg:row-span-2 lg:row-start-1",
  week: "lg:col-span-4 lg:col-start-1 lg:row-start-2",
} as const;
