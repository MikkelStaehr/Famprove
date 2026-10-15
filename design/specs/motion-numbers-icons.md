# Spec-lite: `motion-numbers` + `motion-icons` (2026-10-15)
Reference: `design/reference/famprove-motion.html` (`setRoll`, `.rc`, `.i-dumb`/`.i-line`/`.i-b`, `playIcon`). Timings: DESIGN.md Part B "Motion".

## motion-numbers: RollingNumber
1. **Question:** "Did this number just change?" Shown only when it did (after ↻ or a set tap), never on first paint. No primary action; it confirms one.
3. **Flow:** first paint / SSR → plain final text, no columns animated. Value changes after mount → each changed digit rolls to its new value. ↻ spins while fetching (`Refresh.tsx:144`, unchanged); the numbers roll when the refreshed values land.
4. **Copy:** none new. The text is exactly the formatted value the screen shows today (comma decimal, "−" U+2212).
5. **States:** loading = the previous value stays (no roll, no skeleton swap); error/stale = value unchanged, no roll; reduced motion = digits change in place.

**Roll details**
- Wrapper `inline-flex`, Geist Mono, `tabular-nums`, `white-space: nowrap`, `line-height: 1.1em`. Each digit = a column clipped to `height: 1.1em`, `overflow: hidden`, holding 0–9 stacked at 1.1em each; position = `translateY(−d × 1.1em)`.
- 750 ms, `--ease`. Delay = 45 ms × the digit's index **among digits** (left to right; non-digits do not count).
- Non-digits ("−", ",", "+", spaces, "/") are plain spans and swap instantly.
- Structure change (char count differs, or a position switches digit ↔ non-digit, e.g. 9 → 10, "9,8" → "10,2", "−3" → "4"): rebuild with the new text at its final position, **no roll**.
- A digit whose value is unchanged gets no transition (it stays put).
- Server render and first client render use the same wrapper and line-height, so mounting columns changes no box.
- A11y: one `sr-only` span holds the full text; the visual columns are `aria-hidden`. No `aria-live` (↻ already reports status).

**Values that roll (and only these):** /load header: fitness big number (CTL, 1 dp), form (TSB), fatigue (ATL), the week's TSS. Træning: the set counter's done count (the total stays plain). **None on Fokus** (reps, kg, rest timer, progress read mid-set), none in charts, readouts, tiles elsewhere or Analyse.

**Acceptance**
- N1 Hard load and reload of /load and / (any `DEV_FIXTURE`): no transform transition runs; the DOM text equals the final value at first paint (JS disabled shows the same text).
- N2 After ↻ lands a changed value, each changed digit animates 750 ms with `--ease`; the k-th digit's `transition-delay` is k × 45 ms.
- N3 Non-digit characters change with no transition; a digit-count change (9 → 10) shows the new value with no roll.
- N4 The element's bounding box is identical (±0.5 px) before and after a roll and between SSR and hydrated render, at 390 and 1280 px.
- N5 Accessible name of each rolling value = its full displayed text (e.g. "−4,2"); columns are `aria-hidden`.
- N6 `prefers-reduced-motion: reduce`: value changes in place, duration and delay 0.
- N7 No RollingNumber on /fokus (grep: Fokus components do not import it).

## motion-icons: Lucide + animated tab icons
1. **Question:** "Which tab did I just pick?" The chosen tab's icon plays once.
3. **Flow:** tab tap / swipe release onto a new tab → that tab's icon plays once (Træning: dumbbell lifts and tilts 600 ms; Belastning: line draws 650 ms; Analyse: three bars grow 500 ms, 70 ms apart). Re-tapping the current tab, first paint, reload, back/forward to the same tab: nothing.
4. **Copy:** none. Tab labels unchanged.
5. **States:** reduced motion = no icon animation; icons are static in every data state.

**Library:** `lucide-react` is the one icon library (justification: one maintained, tree-shaken set replaces hand-drawn paths). `icons.tsx` is its only importer; `Icon name=…` call sites do not change. Props: `size` as today, `strokeWidth={1.5}` (scaled, not `absoluteStrokeWidth`), `aria-hidden`, `focusable="false"`.

**Map:** bike → `Bike` · arrow-right → `ArrowRight` · chevron-left/right/down → `ChevronLeft`/`ChevronRight`/`ChevronDown` · warning → `TriangleAlert` · check → `Check` · arrow-up → `ArrowUp` · arrow-down → `ArrowDown` · arrow-flat → `ArrowRight` · x → `X` · minus → `Minus` · plus → `Plus` · refresh → `RotateCw`.
**Own paths (not Lucide), everywhere the name is used, round caps/joins:** barbell `M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12` in one `<g>` (lift: −3px/−10° at 35 %, +0.5px/4° at 70 %, origin centre, `transform-box: fill-box`); trend `M3 17l5-6 4 3 4-7 5 5` with `pathLength="1"` (dash draw 1 → 0); bars = three paths `M5 20V11`, `M11 20V5`, `M17 20v-7` (scaleY 0.1 → 1 from the bottom, delays 0/70/140 ms) + baseline `M2.5 20.5h19` (static).

**Acceptance**
- I1 `lucide-react` is imported only in `web/src/components/icons.tsx`; no other SVG icon paths remain in components.
- I2 Every icon renders stroke 1.5, round caps, `aria-hidden`; sizes 16/18/20/22 as before.
- I3 Selecting a tab (tap or swipe) plays only that tab's icon, once, with the durations above; the other tabs' icons do not move.
- I4 First paint, reload, re-tap of the current tab: no icon animation.
- I5 Reduced motion: no icon animation; the tab still switches.
- I6 The animated icon replays on each new selection (A → B → A plays A twice).
