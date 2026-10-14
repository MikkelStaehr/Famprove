# Spec-lite – Visual reset: Belastning (`/load`) (2026-10-14)

> **Superseded in part by `review-round.md` (2026-10-14):** the order (§2, §8: the week card comes after the tiles), the curve's line, today line and `I DAG` (§3), every readout at rest and the hover tooltip (§3–5), the grid's day labels and week numbers (§4), the week card's `I alt` and `—` rows (§6), acceptance 6, 7, 10, 11, and the dropped `72 / ~430`.

Look and layout of `/load` in DESIGN.md Part B **Ember**, combining the user's mockup variants A, B and C (local, git-ignored; every value is restated here). **Behaviour, data and copy stay as `load.md`** (zone reading §8a, explainer §8b, prognose §9–10, week card §6, states §5) unless a section below replaces them. When this spec and the mockup disagree on look, the mockup wins; on numbers, CLAUDE.md wins (Python owns them, missing is never 0).

## 1. Question and primary action
"How loaded am I right now, and is fitness going up?" No primary action (read-only). Controls: TabBar, two `SegmentedControl`s, the week switcher, `<details>`.

## 2. Order at 390 (top to bottom; page padding 20/16, 12px between cards)
0. **Header** (padding 4px 4px 8px): h1 `Belastning` `text-22` Geist 600 −0.01em; under it (2px) the existing updated line in Geist Mono `text-12` `--text-muted`. **No gear button.** Stale: the line becomes a `WarningLine` (stale copy, `load.md` §4). Then each `app_notices` row as a `WarningLine` (8px apart).
1. **Form card** (A) – §2a.
2. **Tiles row** (A) – §2b.
3. **Fitness curve card** (C) – §3.
4. **Training-day grid card** (B) – §4.
5. **TSS pr. dag card** (B) – §5.
6. **Week list card** (A) – §6.
(Superseded: the week card now comes third, after the tiles – `review-round.md` §1.)
Above the fold at 390 × 844 (minus `--bottom-bar`): form card, tiles, and the curve card's header + plot top.

### 2a. Form card
`Card`, `--radius-card` 22, padding 20, gap 16.
- Row 1 (`justify-between`, `items-start`): h2 styled as `MonoCaption` `text-12` `FORM I DAG`; `ZonePill` with the zone word (`Risiko` · `Optimal` · `Neutral` · `Frisk` · `Pause`, the mockup's words, set in `FORM_ZONE_DISPLAY`).
- Row 2 (flex, `items-baseline`, gap 10, `flex-wrap`): TSB `text-56` Geist Mono 500 −0.03em in the zone colour (`−14`, U+2212; `+4`; whole numbers as now); beside it the zone-reading sentence (`load.md` §8a, exact copy) Geist `text-15` `--text-muted`, `flex: 1 1 12rem`, wraps (≤ 3 lines at 390; at 200% text it drops under the figure).
- Row 3: `ZoneBar` (DESIGN.md Part B components): segments 8px, gap 3, widths on the zone scale, active segment in zone colour, others 30 %, the 2 × 14 `--text` tick at today's TSB, labels `text-11` mono under (8px), active label zone colour 500.
- Foot: `Zonerne er grove ved lav fitness.` Geist `text-13` `--text-muted`.
- Hero sr sentence unchanged (`load.md` §4), first in the card.
- Zone null: figure in `--text`, no pill, no active segment, `Zone ikke beregnet.` under the bar. TSB null: row 2 is `Form er ikke beregnet endnu.` (`text-15` `--text`), no bar.

### 2b. Tiles row
`<dl>`, grid 3 × `minmax(0,1fr)`, gap 12. Each `Tile` (radius 18, padding 14, gap 6): `<dt>` label `text-11` mono muted, `<dd>` value `text-24` mono 500, supporting line `text-11` mono.
| Tile | Label | Value | Supporting line |
|---|---|---|---|
| Fitness | `FITNESS` | `ctl`, whole number | arrow icon (12px, up/down/flat by the sign of Python's `ctlRamp7d`) + `3 / 7 d` in `--text`; null: `– / 7 d` muted. sr: the existing fitness-delta sentence (`Fitness stiger: +3 på 7 dage`) |
| Fatigue | `TRÆTHED` | `atl`, whole number | `TSS/DAG` muted (no stored 7-day ATL change exists; the mockup's `↑ 9 / 7 d` is dropped) |
| This week | `UGE 42` (current ISO week) | `weekly_load.total_tss` of the current week | `TSS · 3/7 d` muted, `3` = `weekly_load.days`. Null total: `–` |
The tiles always show today / the current week, whatever week the list shows.

## 3. Fitness curve card (C)
`Card` with `--radius-hero` 26, padding 22px 20px 16px, gap 18. Recharts (as now), `isAnimationActive={false}`.
- **Header:** h2 `SectionTitle` `Fitness` left; `MonoCaption` `TSS/DAG` right. (C's 48px `19,2` header is dropped: the Fitness tile shows it; see Dropped.)
- **Plot:** height 180 at 390, 200 from 640, 280 from `lg`. Top 16px = block strip. Series: CTL only. Measured: 2px `--text`; prognose: 1.5px `--text-muted` dashed 3 4 from today on; band (after the block, `DEV_FIXTURE=band`): `ctl_low`–`ctl_high` area `--text-muted` 12 %, no stroke. Gridlines: three, 1px `--border` dashed 2 4, at nice steps of the visible y extent (drawing scale: the visible CTL and band min/max rounded out to the next 10); labels mono `text-11` muted inside the right edge. Today: 1.5px `--today` line, full plot height, `I DAG` mono 11 `--today` end-anchored 4px left at the bottom; today's point r 5, `--bg` fill, 2px `--text`. Strength blocks: bracket in the strip (DESIGN.md Chart marks), deload part dashed.
- **X labels:** mono `text-11` muted: window start, the month starts that fit (`sm` more), window end; 4px under the plot. No label at today (the `I DAG` caption is it).
- **Readout row** (DESIGN.md "Charts: interaction"): cells `Fitness` · `Træthed` · `Form`, facts as now (block, prognose basis, `Spænd: …`). Fatigue and form per day live here.
- **Control row** (`justify-between`, `items-center`): `SegmentedControl` `4U` · `12U` · `Sæson` (padding 7px 10px, `role="group"` `aria-label="Periode"`, buttons with `aria-pressed`; client state, default **12U**, not in the URL); legend right: `- - - prognose` mono 11 muted, plus `spænd` (a 10 × 10 swatch at 12 %) when a band is visible, plus `Blok` (a 14px bracket) when a block is visible.
- **Ranges** (inclusive; prognose from `daily_projection`, never extended):
| Range | History | Prognose shown |
|---|---|---|
| `4U` | today − 27 … today (28 days) | 14 days |
| `12U` | today − 83 … today (84 days) | 28 days |
| `Sæson` | 2026-01-01 … today (`daily_load` is already read in full) | all 56 days |
Today sits at ≈ 67–84 % of the width, so the forward line reads as C's.
- **Foot** (after the readout, `text-13` muted, 60ch): the existing prognose / typical-rides notes (`load.md` §9–10), then the `Hvad betyder det?` disclosure (`load.md` §8b copy; summary Geist 15/500, 44px, 16px chevron; swatches = these marks).
- sr text: `load.md` §4/§9d/§10d sentences, with the window's start and end dates of the selected range; announced again (polite) when the range changes.

## 4. Training-day grid card (B)
`Card` radius 22, padding 18, gap 14. h2 `Træningsdage` left, `MonoCaption` `12 uger` right.
- **Grid:** 12 ISO weeks (Mon–Sun) ending with the current week; one column per week, rows Mon → Sun. Cells 20 × 20, gap 4, `--radius-cell` 4. Row labels mono 11 muted at rows 1, 3, 5, 7: `M` `O` `F` `S`, 10px left gap. Month labels under the grid (mono 11 muted, `jul.` `aug.` …) at the first column whose Monday starts a new month, 24px left inset. Days after today are not drawn (empty slots, not rest).
- **Shade = drawing scale of `daily_load.total_tss`** (fixed thresholds, not computed per window):
| Level | Total TSS | Fill | Why |
|---|---|---|---|
| rest | 0 | `--track` | nothing done |
| 1 | 1–49 | `--shade-1` | a short spin or a light session |
| 2 | 50–99 | `--shade-2` | one normal session: a strength session is anchored at ~60 TSS (`STRENGTH_K`), an hour of Z2 on Zwift lands in this band |
| 3 | ≥ 100 | `--text` | a long ride, or a ride plus strength on one day |
`tester` reports the count per level over the current 12 weeks at render time (computed by its owner, not written here).
- **Before the strength log** (days before the earliest `blocks.start_date`, 2026-08-10): strength is *ikke registreret*. A day with a ride is shaded by its total (cycling only) and its readout says `Styrke ikke registreret`; a day without a ride is **unknown**: no fill, 1px dashed `--shade-1` outline, never `--track`. When the window holds such days, a line under the legend: `Styrke er ikke registreret før 10. aug.; dage uden cykling er ukendte.` (`text-13` muted).
- **Today:** 1.5px `--today` outline, offset 1px.
- **Legend** (mono 11 muted, gap 6): `Hvile` ▪ ▪ ▪ ▪ `Hård` (12 × 12 swatches, radius 3), then `TSS 0 · 1–49 · 50–99 · 100+` as a second line (units), plus a dashed swatch `Ukendt` when unknown days are shown.
- **Interaction:** a chart (DESIGN.md "Charts: interaction"): tap / drag / ←→↑↓ selects a cell (1.5px `--text` outline); readout row under the legend: `tirs. 13. okt.` · `Cykel 0` · `Styrke 72` · `I alt 72` (`daily_load` values; strength `–` before the log).
- sr: `Træningsdage de sidste 12 uger, fra 21. jul. til 14. okt. Hver dag i tabellen nedenfor.` + a visually hidden `<table>` (caption `Træningsdage`, columns `Dato` · `Cykel` · `Styrke` · `I alt`; `ikke registreret` where missing). Level-1 cells are under 3:1 against the card (1.91), so this table and the readout are what make the grid's values perceivable (DESIGN.md contrast table).

## 5. TSS pr. dag card (B)
`Card` radius 22, padding 18, gap 14. h2 `TSS pr. dag` left; `SegmentedControl` `4U` · `12U` right (`aria-label="Periode"`, default **4U**, own state).
- **Bars:** one per day, today − 27 … today (4U) or − 83 … today (12U); plot 130px, gap 4px (4U) / 1px (12U), baseline 1px `--axis`. Cycling solid `--text` at the bottom, strength hatched `--shade-2` on top when both (DESIGN.md Chart marks). Zero day: 2px `--axis` stub. Height scale: the visible window's largest `total_tss` rounded up to 50 (drawing); one dashed `--border` gridline at that top with its label (`150`) mono 11 muted, right.
- **Before the strength log:** over those days a bracket in a 16px strip above the bars, 1.5px `--text-muted` dashed 3 3, label `styrke ikke registreret` mono 11 muted; days without a ride there draw no stub.
- **X labels** mono 11 muted: start date, middle date, `i dag`. Legend: `Cykel` (solid 10 × 10) · `Styrke` (hatched 10 × 10).
- **Readout row** as §4 (same cells), only after a tap, drag or keyboard selection; no rest row and no reserved space (user, 2026-10-14; the grid's readout likewise).
- **Foot:** `Styrke-TSS er et skøn (K ukalibreret).` `text-13` muted.
- B's `CYKEL / STYRKE / I ALT` window totals are **dropped** (sums over a window; SQL owns sums only per ISO week). This week's total is the `UGE` tile.
- sr: `Daglig TSS fra 17. sep. til i dag, cykel og styrke. Tallene står i tabellen under Træningsdage.` (the 12U range is inside the grid's 12 weeks.)

## 6. Week list card (A)
`Card` radius 22, padding 18, gap 4.
- **Header** (padding-bottom 10): h2 `Uge 42` (`SectionTitle`) left; `MonoCaption` `12.–18. okt.` right.
- **Rows:** `ListRow` per day (behaviour DESIGN.md "Week list", `load.md` §6). Day `Man`…`Søn`. Icon: barbell for a strength day, bike for a ride day, both (bike then barbell, 4px apart) when both; none on rest. Text: `Styrke · session 2` / the ride name as in intervals.icu / both joined ` · `; rest `Hvile`; before the log `Ingen cykling · styrke ikke registreret` (muted). Value: the day's `total_tss` (mono 14). **Today:** day label `--text` 500; value column shows `I DAG` mono 11 `--today` (left of the value, gap 8, when there is load). The row is the `<summary>`; its expanded content (rides with NP/IF/VI, power badge, strength exercises) sits under it, indented 48px, Geist `text-13` / mono `text-13`, 8px top, 12px bottom.
- **Total row:** last `ListRow`, text `I alt` (Geist 14/500), value `weekly_load.total_tss` mono 14/500.
- **Switcher** (foot, 12px above): `‹ Uge 41` left and `Uge 43 ›` right as secondary buttons (44px, 1px `--text-muted` border, `--radius-button`, Geist 14/500, chevron 16); `Tilbage til denne uge` text link centred between them when another week is shown. Ends: the button is absent, an empty 44px box keeps the layout. `aria-label` names the target week (`Gå til uge 41`).
- **Planned sessions (user, 2026-10-14, slice `week-shared`):** the current week's rows come from `lib/week-plan.ts`, the same source as Træning's week card: today's planned session reads `Styrke · session 2` with the barbell and `I DAG`; undated later sessions follow as `—` rows with a muted barbell and `plan`. Past weeks show no plan rows.

## 7. States (DEV_FIXTURE names)
| State | Treatment |
|---|---|
| loading | skeleton cards in §2's order and §8's grid, `--raised` bars at content sizes |
| `empty` | header + one full-width `EmptyState` card, `load.md` §4 copy; no tiles, charts or list |
| `error` | header + one `ErrorState` card (`Kunne ikke hente træningsdata` …, `Prøv igen`) |
| `stale` | updated line → `WarningLine` with the stale sentence; every card as normal |
| `band` | the band area on the curve wherever it falls in the range; `spænd` legend; `Spænd: fitness 44 til 49` in the readout |
| chart empty / error | inside the curve card, `load.md` §4 copy; the other cards unaffected |
| grid / bars with no rows in range | inside the card: `Ingen dage med data i perioden.` `text-13` muted |
| week detail error | `ErrorState` inside the week card (as now) |

## 8. Desktop (from `lg`, 1280: content 1200, 3 columns × 384, gap 24, `items-start`)
| Card | Placement |
|---|---|
| Header row | full width above the grid (h1, updated line, notices) |
| Form card | col 1, row 1 |
| Tiles row | col 1, row 2 |
| Fitness curve | cols 2–3, rows 1–2 (plot 280px) |
| Training-day grid | col 1, row 3 |
| TSS pr. dag | cols 2–3, row 3 |
| Week list | cols 2–3, row 4 |
DOM order stays §2. TabBar: desktop top bar (DESIGN.md).

## 9. Data check
| Value | Status | Field |
|---|---|---|
| TSB, zone, CTL, ATL, ramp | exists | latest `daily_load` (`tsb`, `form_zone`, `ctl`, `atl`, `ctl_ramp_7d`) |
| Fitness series 2026-01-01 → today | exists | `daily_load` (read in full) |
| Prognose + band | exists | `daily_projection` (`ctl`, `ctl_low`, `ctl_high`, basis) |
| Blocks + deload | exists | `blocks` |
| Daily cycling / strength / total TSS (grid, bars, row values) | exists | `daily_load.cycling_tss`, `strength_tss`, `total_tss`; WeekView may need `total_tss` added to its select (no migration) |
| Strength-log start | exists | earliest `blocks.start_date` (2026-08-10) |
| Current week total + days | exists | `weekly_load.total_tss`, `days` for the current ISO week (read even when `?week=` shows another) |
| 7-day ATL change | **missing** | not stored: tile shows `TSS/DAG` instead |
| Window totals per range | **missing** (sums) | dropped |
| Planned sessions in the week list | not read by `/load` | dropped |

## 10. Accessibility
- Headings: h1 `Belastning`; h2 per card (`Form i dag`, `Fitness`, `Træningsdage`, `TSS pr. dag`, `Uge 42`); the tiles are a `<dl>` with no heading.
- Every chart: sr sentence (above), readout row `aria-live="polite"`, keyboard group, focus ring on the plot.
- Selectors: `SegmentedControl` = `role="group"` + `aria-label="Periode"` + `aria-pressed`; hit area ≥ 44 × 44; selected differs by weight and fill, not colour alone.
- Zone colour always beside the zone word (pill, active label, sentence). Bars: cycling vs strength by solid vs hatch.
- `--today` only as line, outline and `I DAG`; never on the inverse card.

## 11. Acceptance checklist (review against the mockup)
1. 390: order header → form card → tiles → curve → grid → bars → week list; no gear; 12px between cards; page padding 20/16.
2. Cards: `#1A1A19` fill, 1px `#262624` border; radii form/sections 22, tiles 18, curve 26; no shadows.
3. Fonts: every glyph renders in Geist or Geist Mono (no system fallback); numbers in Geist Mono.
4. Form figure 56px Geist Mono 500 in its zone colour; pill and active ZoneBar label show the zone word in the same colour; inactive segments at 30 %; today tick on the bar.
5. Tiles: `FITNESS` / `TRÆTHED` / `UGE N`, values 24px; fitness ramp from Python; no computed ATL delta; week total from `weekly_load`.
6. Curve: fitness 2px cream line, prognose 1.5px muted dashed, dashed gridlines with mono labels, orange 1.5px today line with `I DAG`, block brackets; 4U / 12U / Sæson switch the window as §3's table, default 12U.
7. Readout row on curve, grid and bars: tap/drag/keys; the curve shows `Seneste · …` at rest with a fixed height, the grid and bars show nothing until a day is selected (user, 2026-10-14).
8. Grid: 12 ISO-week columns Mon–Sun, 20px cells, 4 shade levels by §4's thresholds, today outlined orange, pre-2026-08-10 days without a ride dashed (unknown), never shown as rest.
9. Bars: cycling solid, strength hatched, stacked when both; 4U/12U; no window totals; `styrke ikke registreret` bracket where it applies.
10. Week list: day | icon | text | value rows with hairline borders, `I DAG` in orange on today, `I alt` row, switcher buttons 44px, `<details>` day expansion intact.
11. Orange appears only as the today line, the today cell outline and `I DAG` (search the CSS: `--today` used nowhere else).
12. Every control ≥ 44 × 44 hit area; visible focus ring on all of them.
13. States: `empty`, `error`, `stale`, `band` as §7; notices, K note, `Zonerne er grove ved lav fitness.`, explainer and updated line all present.
14. 1280: §8 placement, content ≤ 1200px, top TabBar; 200% text: no horizontal scroll.
15. Contrast: `tester` recomputes DESIGN.md's table on the rendered page; text ≥ 4.5, meaningful marks ≥ 3.

## Dropped from the mockup (and why)
- Gear button (A): no settings page.
- A's three-series chart (fatigue dashed + form bars): replaced by C's curve as ordered; fatigue and form per day are in the readout.
- C's `19,2 ↑ 3,1` header, `højeste siden maj`, `HØJ 26 / LAV 9`: duplicates the tile; max/min/"highest since" are new figures the web may not compute.
- C's form and fatigue half cards, C's "I dag" card and 7-day strip: A's form card, A's tiles and A's week list were chosen; the "I dag" card goes to Træning.
- `↑ 9 / 7 d` on fatigue (A, B): no stored ATL change.
- B's `CYKEL / STYRKE / I ALT` window totals: sums over a window.
- B's form/fitness/fatigue strip: A's form card + tiles were chosen.
- C's `72 / ~430 TSS`: a planned week total is not stored. (A's `plan` rows came back on 2026-10-14, see §6.)
- 1M / 3M labels (A): the user's 4U / 12U / Sæson.
- 10px axis labels: 11px minimum.
- ZoneBar flex widths 2/2/1.5/1.5/1: the zone scale's true widths (10/20/15/15/10) so the today tick is truthful.
