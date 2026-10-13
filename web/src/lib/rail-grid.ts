/**
 * The desktop grid of /analyse and /analyse/styrke (analyse.md §11, DESIGN.md Part A "Layout: phone
 * and desktop"), shared by each page.tsx and its loading.tsx so the skeleton never jumps. Below lg
 * one column in phone order, sections 40px apart (Part B Revision 5); from lg a sticky rail (cols 1–4) and the main column (cols 5–12).
 */
export const RAIL_GRID = {
  grid: "flex flex-col gap-10 lg:mt-6 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6",
  rail: "lg:sticky lg:top-6 lg:col-span-4",
  main: "flex flex-col gap-10 lg:col-span-8",
  /**
   * Cykel's rail (analyse.md §12c): scrolls inside the window, so an opened "?" never pushes content
   * off-screen. -m-3/p-3 gives the focus rings room inside the scroll box without moving the content.
   */
  railScroll:
    "lg:sticky lg:top-6 lg:col-span-4 lg:-m-3 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:p-3",
} as const;
