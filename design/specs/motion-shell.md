# Motion shell: the swipeable tab stack (slice `motion-shell`, design-lead 2026-10-15)
Structure: `docs/decisions/tab-shell.md`. Feel: `design/reference/famprove-motion.html` (local), lines 647–745.
Tokens and timings: DESIGN.md (`--radius-stack`, `--radius-sink`, `--shadow-stack`, Part B "Motion"). Never a raw value here.
**Question:** where am I among Træning · Belastning · Analyse, and how do I move? **Primary action:** none of its own;
each page keeps its own. p = the continuous position (0 Træning, 1 Belastning, 2 Analyse); the URL owns the settled index.

## 1. Card stack (per page i, d = i − p; z-index i + 1; `transform-origin: 50% 40%`)
- **Right page (d ≥ 0):** `translate3d(d·w, 0, 0)`, w = the viewport width. Left corners `--radius-stack` while d > 0
  (0 at rest). `--shadow-stack` only while 0 < d < 1. `visibility: hidden` at d ≥ 1 (0.999 in floats).
- **Left page (d < 0), t = min(1, −d):** `translate3d(−0.08·w·t, 0, 0) scale(1 − 0.08t)`, all corners `--radius-sink` × t,
  no shadow, a black scrim over it at opacity 0.55t (an overlay element, never `filter`). Hidden at t ≥ 1.
- Only `transform`, `opacity`, `border-radius`, `box-shadow`, `visibility` change per frame; no layout reads in the loop
  except w (read on resize).
## 2. Drag (phone only)
- Pointer types `touch` and `pen` only; never `mouse`; no drag from `lg`. Start ignored within 22px of either viewport
  edge (system back gesture) and on any `[data-noswipe]` element: every chart plot carries it.
- Lock to a swipe when |dx| > 10 and |dx| > 1.3·|dy| (then pointer capture); |dy| > 10 first = a scroll, the drag ends.
- While locked: p = index − dx/w; past either end the overshoot × 0.3 (rubber band). A running animation is cancelled.
- **Release:** |dx| > 22 % of w or |v| > 0.45 px/ms → the neighbour in that direction, else back to the index.
  Then animate p to the target, 440 ms easeOutQuart. The click that ends a locked drag is swallowed.
## 3. Tabs, URL, history
- A tab tap or click (phone bar, `lg` top bar, keyboard Enter) runs the same 440 ms animation; the URL changes by
  `pushState` at once (tab-shell §1). Back/forward animate to the URL's index. Focus stays on the activated tab.
- **Indicator:** phone bar only, DESIGN.md "Navigation": 2px `--text`, 28px inner bar centred, on the top edge,
  translated by clamp(p, 0, 2) × tab width every frame. **`lg`:** no indicator; the current tab keeps its `--raised`
  fill, switched when the target is set. **200 % text:** static strip at the top, no indicator, no change otherwise.
- The new tab's icon plays once (DESIGN.md Motion) when the index changes; not on first paint.
## 4. Pages
- Each page is its own scroll container (`overflow-y: auto`, `overscroll-behavior: contain`) with its own scroll
  position, kept across tab changes. `scroll-padding-bottom: var(--bottom-bar)` and the bar padding move from `html`/
  `main` onto that container, so WCAG 2.4.11 still holds.
- Inactive pages (every page but the settled index): `inert` + `visibility: hidden` at rest, never `display: none`.
  During a move both visible pages render; only the settled one is interactive.
- Loading and error are per page (tab-shell §7): a skeleton or ErrorState page slides like any other.
## 5. Reduced motion and first paint
- `prefers-reduced-motion: reduce`: tap, release and back/forward snap (duration 0); a drag still follows the finger
  (it is direct manipulation) but release snaps; no icon play.
- First paint (hard load, reload, `router.refresh()`): the settled page at p = index, no animation.

## Acceptance criteria (`tester`, at 390 and 1280; drag via touch emulation)
- **M1** At 390, a horizontal touch drag on a non-chart area of Belastning moves both pages with the finger every frame;
  the right page shows `--radius-stack` left corners and `--shadow-stack`, the left one scales, darkens and rounds.
- **M2** Release after > 22 % of the width (or a flick > 0.45 px/ms) lands on the neighbour, URL updated
  (`/load` → `/analyse`); release below both returns to the same tab, URL unchanged.
- **M3** A drag that starts on a chart plot, within 22px of an edge, or with a mouse moves nothing; a mostly vertical
  drag scrolls the page.
- **M4** Dragging right on Træning or left on Analyse moves p at 0.3× and springs back; the URL never changes.
- **M5** A tab tap animates 440 ms (Performance panel or frame captures), same transform as a swipe; at 1280 a
  top-bar click does the same and the `--raised` fill moves to the clicked tab.
- **M6** On the phone bar the 2px indicator sits under the tab matching p mid-drag (half-way drag = half-way indicator).
- **M7** Scroll Belastning down, go to Træning and back: Belastning's scroll position is unchanged.
- **M8** At rest, the inactive pages are `inert` (Tab never reaches them; a screen reader's list of headings shows only
  the current page) and `visibility: hidden`.
- **M9** With `prefers-reduced-motion: reduce`, a tab tap changes page in one frame; no icon plays.
- **M10** A hard load of `/load`, `/train` or `/analyse/styrke` paints the final state with no animation.
- **M11** At 200 % text the bar is a static strip with no indicator; tabs still switch pages.
- **M12** Browser back after two tab changes animates to the previous tab and its URL.
