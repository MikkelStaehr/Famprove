# Spec – Instrument restyle: Belastning (`/load`) (slice `instrument-rest`, 2026-10-13)

Restyles `load.md` (§2–§11) to DESIGN.md Part B Revision 5. **Same data, copy, readout behaviour, sr text, week-card behaviour and desktop grid** (`load.md` §11a: rail hero, main chart, rail week card). Only the look changes. The chart is the living element; the zone ruler is the hero's scale.

## 1. Element map (390; 1280 = the same pieces in the `load.md` §11a grid)
| Current | Instrument form |
|---|---|
| h1 `BELASTNING` Condensed | h1 `Belastning` Inter 400 `text-32`; UpdatedLine + `app_notices` WarningLines (◆ + words) unchanged in place |
| ZoneBar hero: slab flag, 5 coloured bands, outline | **Zone ruler** (§2). Figure row above it: `caption` `FORM (TSB) · TSS/DAG`, 8px, value Inter 400 `text-56` tabular (`+4`, `−12` U+2212; the largest text), 12px, zone name Inter 400 `text-24` `--text` (`Gråzone`) on the value's baseline |
| Fitness delta, detail line, zone reading | Inter `text-16` `--text` (arrow SVG + words, neutral), `text-14` muted. Unchanged copy |
| Chart card (surface, radius, title Barlow) | Section: heading `Fitness, træthed og form` Inter 400 `text-20`, hairline, legend, plot at `--chart-height`, x labels, readout row, disclosure, notes |
| Legend (swatches) | Rev 5 swatches (mark forms, §3), `text-14` muted. Items without value stay: `Styrkeblok`, `Deload-uge`, `Prognose` |
| Week card | Section; switcher arrows 44×44 with 1px `--text-muted` outline, radius 0; title Inter `text-20`; day rows with the **day barcode** (§4) |
| "Hvad betyder det?" `<details>` | Inter 500 `text-16`, chevron, 44px, no fill; swatches = §3 marks |
| Tooltip (pointer) | `--bg` box, 1px `--text-muted` border, radius 0, no shadow; lines as the readout |

## 2. Zone ruler (monochrome; replaces the five zone colours)
`<svg viewBox="0 0 366 40" width=100%>`, `aria-hidden`; scale −40…+30 linear (`zone-scale.ts` constant unchanged).
- Baseline 1px `--text-muted` at y 24. Minor ticks every 5 TSS/dag: 1×6 `--text-muted` up from the baseline. Threshold ticks at −30, −10, 5, 20: 1×14 `--text`. Threshold numbers mono 12 `--text-muted` under (HTML, real text).
- **Active zone** (from `daily_load.form_zone`, never compared in the UI): its span is drawn as a 3px `--text` bar on the baseline (thickness = shape). Inactive spans: baseline only. Zone null: no bar.
- **Today**: a 2×28 `--accent` tick at `x(tsb)` (the red "now" tick, Part B signature 1). Out of range: tick pinned at the end with an 8px outward chevron in `--text`.
- The zone name is always the word in the figure row; no colour anywhere. sr sentence unchanged (`load.md` §4).

## 3. The living element: the chart as marks (Recharts `ComposedChart`, `isAnimationActive={false}`)
Window, axes, readout, keyboard and pointer exactly as now (`load.md` §9–10, DESIGN.md "Charts: interaction"). Marks: the user's brief reads "a tick per day, three line weights in ink" (main session's reading, 2026-10-13): every series is a tick per day in `--text`, told apart by weight (3 / 1.5 / 1px) and form (dash, dash, needle), never by colour; no connecting lines.
| Series | Measured (≤ `lastActual`) | Prognose (> `lastActual`) |
|---|---|---|
| CTL (fitness, the answer) | **one tick per day**: a horizontal ink dash at the day's value, width = day pitch − 1px (min 1.5px), **3px** thick, `--text` (`<Scatter>` with a custom `shape`; no line) | hollow dots: `<Scatter>` r 2, fill none, stroke 1 `--text`, every 2nd day below `lg`, every day from `lg` |
| ATL (fatigue) | one tick per day as CTL, **1.5px** thick, `--text` | hollow dots r 1.5, stroke 1 `--text`, same cadence |
| TSB (form) | **one tick per day**: a vertical needle from 0 to the value, **1px** wide, `--text` (`<Bar dataKey=tsb barSize=1>`) | the same needles dashed (`strokeDasharray 1 2`, 1px outline, no fill) |
| CTL band after the block | – | a 1px `--text-muted` vertical range tick from `ctl_low` to `ctl_high` every 4th day (a comb, behind the dots). No area fill |
| Zero line | 1px `--text-muted` | same |
| Strength block | **hairline bracket** in the 24px annotation strip: 1px `--text-muted` line `start_date` → `end_date` (ongoing: → `lastActual`) with 6px down-ticks at both ends, label `B12` (below 640) / `Blok 12` mono 12 `--text-muted` centred above, omitted when narrower than the label | – |
| Deload | the bracket's deload part dashed 3 2; the readout and sr name it | – |
| Today | the **red today tick**: 2×12 `--accent` on the x-axis baseline at today, plus a 1px `--text-muted` dotted (1 3) rule full height; `I DAG` caption `--text` in the strip, end-anchored 4px left. Today's three values: CTL/ATL dots r 3 filled `--text`, 2px `--bg` ring | – |
| Prognose region | no fill: `PROGNOSE · ANSLÅET` caption start-anchored 6px right of the rule; the hollow marks are the region | – |
| Gridlines | none; y ticks mono 12 | – |
`--block-fill`, the hatch pattern, `--prognose-band` and the region fill are deleted. Marker on selection: 1px `--text` rule (as now).

## 4. Week card: day barcode
Each day row (`<summary>` of the `<details>`) gets an `aria-hidden` SVG in the row grid between the day label and the three 64px columns (`1fr`, min 48px): **one tick per 10 TSS**, n = round(tss / 10), pitch 3px, tick 1px. Cycling ticks 1×16 `--text`; strength ticks 1×8 `--text`, after a 4px gap. Ticks past the width stop, and a 1px × 16 `--text` end bar + 2px gap marks the overflow. Rest day (`Hvile`): no SVG. Null TSS: no ticks for that part. Below `@xs` (narrow / 200 % text) the barcode moves under the numbers, full width. The row's sr text (`cykling 86 TSS, …`) already carries the values; nothing added.

## 5. States (copy unchanged, `load.md` §5, §6, §9e, §10e)
- **Loading**: same grid classes; ruler skeleton = real caption, 56px `--surface` bar w-1/3, the real baseline and threshold ticks with no active bar and no red tick; chart = real heading, legend bar, a `--chart-height` `--surface` block; week card bars. `motion-safe` pulse only.
- **Empty / Error**: EmptyState / ErrorState over the full grid width (Rev 5 look). Chart error inside its section.
- **Stale**: UpdatedLine ◆ + words; the today tick stays at today, measured lines end at `lastActual` (the gap shows).
- **No TSB / zone null / out of range**: §2 rules; `Form er ikke beregnet endnu.` in place of the value.
- `DEV_FIXTURE=band`: comb visible after the block.

## 6. Acceptance criteria
1. Fold 390 × 844 (disclosure closed, 2-line reading, one notice, both themes): plot incl. x labels ends ≤ 844 − `--bottom-bar` (owner computes). 1280 × 800: hero visible, plot incl. x labels ≤ 800, week card starts ≤ 800.
2. Exactly two `--accent` marks on the page: the ruler's today tick and the chart's today tick (both are "today"). No other red.
3. No zone colour, `--slab*`, `--block-fill`, area fill, gradient or gridline; every mark per §3 (DOM inspect in `band`).
4. CTL, ATL and TSB ticks: one per day each in the window, all `--text`, weights 3 / 1.5 / 1px; prognose marks hollow/dashed only after `lastActual`.
5. Brackets: one per block in the window, deload part dashed; labels never clipped.
6. Day barcode: tick count = round(tss/10) per part in a fixture week; rest rows draw nothing.
7. Readout, tooltip, keyboard per DESIGN.md "Charts: interaction"; all contrast ≥ AA computed (marks ≥ 3:1, text ≥ 4.5:1).
8. Screenshots 390 and 1280, dark and light: live, `band`, `stale`, `empty`, `error`.
