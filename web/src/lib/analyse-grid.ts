/**
 * The page grid of /analyse and /analyse/styrke (reset-analyse-cykel.md §6, reset-analyse-styrke.md
 * §7, DESIGN.md Part A "Layout"), shared by each page.tsx and its loading.tsx so the skeleton never
 * jumps. Below lg one column in phone order, cards 12px apart; from lg three 384px columns 24px
 * apart (Part A), the chart cards spanning columns 1–2 (Cykel) or 2–3 (Styrke), all one width so
 * shared x axes, seams and the today line align. DOM order is always the phone order.
 */
export const ANALYSE_GRID = {
  grid: "flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:items-start lg:gap-6",
  /** Cykel: chart cards in columns 1–2, one under the other. */
  cykelChart: "lg:col-span-2 lg:col-start-1",
  /** Cykel: Udeladte ture in column 3 beside the charts, sticky. */
  cykelSide: "lg:sticky lg:top-6 lg:col-start-3 lg:row-span-3 lg:row-start-2",
  /** A state card (error, empty) replacing the whole grid. */
  full: "lg:col-span-3",
  /** Styrke: the hero (sticky) and the feel card in column 1. */
  styrkeSide: "lg:col-start-1",
  styrkeHero: "lg:sticky lg:top-6 lg:col-start-1 lg:row-start-1",
  /** Styrke: chart cards in columns 2–3. */
  styrkeChart: "lg:col-span-2 lg:col-start-2",
} as const;
