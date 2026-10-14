# Spec-lite – Visual reset: Analyse › Cykel (`/analyse`)

Reference: `design/reference/belastning-mockup.html` (A tiles + list rows, B bars, C curve card). The mockup wins on look.
Supersedes the **visual** parts of `analyse.md` (§3, §4 drawing, §5 drawing, §11, §12a/c) and all of `instrument-analyse.md`.
**Unchanged:** every behaviour, number, rule and Danish string in `analyse.md` (§4 domain/ticks/seam rule, §5a exclusion table, §5b–e rules, §6 copy, §7 sr text, §8/§12d states, §12e sentences). Python owns every number; the three answers render `analysis_summary` verbatim. No new calculation, no migration, no range selector (the x domain stays 1 Jan 2025 → today).
Names below are the shared vocabulary (tokens, Card, Tile, SegmentedControl, TabBar, ListRow, SectionTitle, MonoCaption).

## 1. Question and primary action
"Is my cycling going up?" Read the three answers; the one action is tapping a chart to read a ride/week (no primary button on this screen).

## 2. Layout at 390 (page padding 20 top / 16 sides, 12px between cards)
1. **Screen header** (shared, DESIGN.md): h1 `Analyse` Geist 22/600 −0.01em; under it MonoCaption 12 muted = the UpdatedLine text (`opdateret 05.00`). Stale: the line turns `--text`, gets a 16px 1.5px warning-triangle icon in front, and the stale note follows in Geist 13 muted. No settings button.
2. **Section tabs**: SegmentedControl, full width, 2 segments `Cykel` · `Styrke`, links with `aria-current="page"`. Outer: `--bg` fill, 1px `--border`, radius 10, padding 3; segment radius 7, height 38 → total hit 44. Label Geist 14; current = `--raised` fill + `--text` 500, other `--text-muted` 400. h2 `Cykel` stays sr-only.
3. **Three answer cards** (§3), stacked, identical.
4. **Card `eFTP pr. tur`** (§4a).
5. **Card `Effektivitet på rolige ture`** (§4b).
6. **Card `Timer og belastning pr. uge`** (§4c).
7. **Card `Udeladte ture`** (§5) or the 0-line.
8. TabBar (shared), Analyse current.

## 3. Answer card (C's hero header, A's tile language)
Card: `--card`, 1px `--border`, radius 22, padding 20, gap 8.
- Row 1: MonoCaption 11 uppercase muted = the question title (h3) left; right a **"?" icon button** 44×44, radius 14, 1px `--raised` border, `--card` fill, glyph `?` Geist 15/500 `--text`. Open (`details[open]`): `--inverse-bg` fill, `--inverse-text` glyph. Name `Forklaring: <title>`.
- Row 2 (baseline-aligned, gap 10): **number** Geist Mono 40/500 −0.03em, line-height 1 (`figure.large` → 48); the neutral arrow before it as a 20px 1.5px-stroke line icon in `--text` (never coloured; sentence carries meaning). sr text `figure.sr` unchanged.
- Row 3: `figure.caption` Geist 13 muted (C's "på 7 dage · …").
- Row 4: verdict Geist 15 `--text`, max 60ch. Row 5: detail Geist 13 muted, tabular.
- Disclosure body (open): hairline `--border` top, 12px above, paragraphs Geist 13 muted.
- `missing` block: row 2–5 replaced by Python's/§12d text Geist 15 muted.
- Answers error (§12d): one Card holding ErrorState in place of the three.

## 4. Chart cards (C's curve card)
Shared card: radius 22, padding 20 (18 sides allowed if the plot needs width), gap 14.
**Header row:** SectionTitle (Geist 16/500, h3) left; right MonoCaption 11 muted unit (`W` · `EF` · nothing).
**Readout row** (DESIGN.md Part A "Charts: interaction", unchanged behaviour, restyled): sits between header and plot, fixed height (ReadoutSpace) so tapping never shifts the plot. Head MonoCaption 11 muted (date/week); value Geist Mono 20/500 `--text`; facts Geist Mono 12 muted (NP/IF/**VI**/TSS for a ride; hours/TSS for a week). Resting = latest + `Tryk på grafen …` in Geist 13 muted.
**Plot language (all three cards, one shared x domain so dates align):**
- Gridlines: dashed `--border` (2 4), 3 horizontal; y labels Geist Mono 11 muted, **right-aligned inside the right edge** (C), no y axis line.
- x labels Geist Mono 11 muted under the plot, ticks per `analyse.md` §4.
- **Today:** 1.5px `--today` vertical line at today's x through the plot, label `I DAG` Geist Mono 11 under it, end-anchored, colour `--today` (4.91:1 on `--card`, DESIGN.md contrast table; the mockup wins). Same x in every card.
- **Pause seam:** two 1px dashed (3 3) `--axis` verticals at the run edges; `INGEN TURE` MonoCaption 10 muted centred in an 18px top strip (omit label if narrower).
- Picked ride/week: 1px `--text-muted` vertical marker + ring.
- Legend at the **bottom** of the card (Main's legend row): Geist Mono 12 muted, swatches 14px, gap 16, wraps.

### 4a. eFTP pr. tur
- Line `--text` 2px through eFTP points, **breaks after > 21 days** (`eftpGapBefore`), nothing carried.
- Points: filled `--text` dots, **radius sized by TSS** (MARKS scale unchanged); latest = C's "you are here" ring: r5, `--card` fill, 2px `--text` stroke.
- Excluded ride: a 7px × cross, 1.5px `--shade-2`, on the plot's bottom edge (never hollow: hollow means estimate).
- Note under the plot (no-watt rides): Geist 13 muted. Empty (< 2 points): EmptyState text in place of the plot, Geist 15 muted, plot-height box with a dashed `--border` frame, radius 14.
- Legend: `eFTP · størrelse = TSS` (three dot sizes) · `Udeladt tur` (cross).

### 4b. Effektivitet på rolige ture
- Rides: small filled `--shade-2` dots (secondary). Trend: `--text` 2px line, drawn only where the view's ≥ 3-rides rule allows (`shownEfTrend`), breaks after > 21 days.
- Excluded: cross as 4a. Y labels 2 dp with comma.
- Too few (`ef-few`): no plot. Geist 16/500 heading + Geist 13 muted text, then ListRows (hairline top, 44px min, date Geist Mono 12 muted left, `EF 1,24` Geist Mono 15 right).
- Legend: `Trend (median over 28 dage)` (2px line) · `Tur` (dot) · `Udeladt tur` (cross).

### 4c. Timer og belastning pr. uge (B's bars)
- Two strips, 96px each, 12px apart: strip label MonoCaption 11 `TIMER` / `TSS` left, y max label right (C style). Only the bottom strip has x labels.
- Week with rides: **solid `--text` bar**, slot − 2px, radius 2 top. Week without rides: 2px `--axis` stub on the baseline (B's empty stubs). Load null with rides: no mark (readout says why). The current week is a normal bar; the today line marks it.
- Card-level error (`cycling_weeks` fails): ErrorState inside this card; other cards unaffected.
- Legend: `Uge med ture` · `Uge uden ture` · `I dag` (orange 1.5px line).
- sr table unchanged.

## 5. Udeladte ture (A's list card)
Card radius 22, padding 0 20. `<details>` summary = the card header: 56px row, SectionTitle text `7 ture udeladt fra trends`, chevron 20px 1.5px stroke right (rotates under `motion-safe`, 180ms).
Body: Geist 13 muted lead `De tæller stadig med i timer og belastning.`, then **ListRows** (1px `--border` top, padding 12 0): left column Geist Mono 12 muted date (`3. jun. 2025`, 88px), right: reason Geist 15/500, explanation Geist 13 `--text`, facts Geist Mono 12 muted. A null fact is dropped.
0 excluded: no card; Geist 13 muted line `Ingen ture udeladt fra trends.` inset 4px.

## 6. Desktop (≥ 1024px)
Content max-width 1200, centred, `grid-cols-3`, gap 16; header and tabs span 3 (tabs max-width 360, left).
- Row 1: the three answer cards, one per column, equal height (stretch).
- Rows 2+: the three chart cards in **columns 1–2** (same width, so seams and today line align down the page); column 3 holds `Udeladte ture` (sticky top 24) with the desktop table (`analyse.md` §11 columns) restyled: MonoCaption 11 headers, `--border` row lines.
- TabBar becomes the shared desktop nav (DESIGN.md). DOM order = phone order.

## 7. States
| State | Treatment |
|---|---|
| Loading | Header + tabs real. Three answer-card skeletons (real question caption, 40px `--track` bar w-1/3 radius 8, two 13px `--track` bars); chart cards with real titles and `--track` plot blocks radius 12; pulse `motion-safe` only. |
| `empty` | One Card with EmptyState text (Geist 15 muted) in place of all cards; header, tabs, TabBar stay. |
| `error` | One Card with ErrorState (title Geist 16/500, what Geist 13, `Prøv igen` = 44px button radius 14, `--inverse-bg` / `--inverse-text`). |
| `stale` | Header line per §2.1; data unchanged. |
| `answers` | All three answer cards with numbers; block 3 `3 af 4`. |
| `ef-few` | 4b too-few list; answer 2 `needs_data`. |
| Answers fail | §3 error card; charts unaffected. |

## 8. Accessibility
- Headings: h1 `Analyse` › h2 `Cykel` (sr-only) › h3 per answer and per chart card.
- Each chart `<figure>` keeps its sr figcaption (`analyse.md` §7); week strips keep the sr table. Gridlines, seams, today line, crosses are `aria-hidden`.
- Chart = one focusable group, ←/→ step, Esc closes; focus ring `--focus` 2px, offset 2, radius 14 on the plot area.
- Targets ≥ 44px: segments, "?", disclosure summary, chart group, error button.
- `--today` as text only for the `I DAG` caption (4.91:1 on `--card`); the line is a graphic (≥ 3:1).
- Colour never alone: answer arrows are neutral; current tab also has weight 500; excluded = cross shape + legend word.

## 9. Data check (all exist; nothing new)
| Value | Status | Field |
|---|---|---|
| Answers: title, number, arrow, caption, verdict, detail, disclosure | exists | `analysis_summary` (state, direction, value, delta, haveN/needN, plannedN/doneN, verdict_text, detail_text) via `analyse-answers` |
| eFTP points, gaps, dot size | exists | `ride_metrics.rolling_ftp_w`, `eftp_ok`, `eftp_gap_before`, `load` |
| EF points, trend, gaps | exists | `ride_metrics.ef`, `ef_ok`, `ef_trend`, `ef_gap_before` |
| Readout NP/IF/VI | exists | `ride_metrics.np_w`, `if_set`, `vi` |
| Exclusions + facts | exists | `ride_metrics.exclusion`, `moving_s`, `distance_m`, `np_w`, `avg_hr` |
| Weekly hours, TSS, zero weeks, seams | exists | `cycling_weeks.week_start`, `rides`, `moving_s`, `load` |
| Updated time | exists | max `computed_at` of the three tables |
| Today x | exists | `resolveToday` |

## 10. Acceptance checklist (review against the mockup)
1. Page `--bg`; every block is a Card (`--card`, 1px `--border`, radius 22); no element sits on `--bg` except header, tabs, the 0-excluded line and TabBar.
2. Section tabs are a full-width SegmentedControl, 44px tall, links with `aria-current`.
3. Each answer card: MonoCaption question, Geist Mono 40 (48 large) number, neutral 1.5px arrow, Python's verdict verbatim, 44px "?" button.
4. Every number on the page (answers, readout values, axis labels, facts) is Geist Mono; every sentence is Geist.
5. Chart cards match C: dashed `--border` gridlines, Geist Mono 11 y labels right-aligned, 2px `--text` main line, no axis lines, legend at the bottom.
6. eFTP dots vary in size with TSS; the line breaks after > 21 days; latest point is a hollow-centre ring.
7. EF trend appears only with ≥ 3 rides in its window (`DEV_FIXTURE=ef-few` shows the list instead).
8. The `--today` line sits at the same x in all three chart cards; `--today` appears nowhere else on the page.
9. Weekly bars are solid `--text`; zero weeks are `--axis` stubs; null load draws nothing.
10. Tapping/dragging a chart updates the readout row without moving the plot; the ride readout shows VI.
11. Excluded rides: crosses on the plot, ListRows in the card, reason and explanation strings exactly as `analyse.md` §5a.
12. At 1280: max 1200 wide, answers 3-up, charts in columns 1–2 with identical widths, Udeladte ture in column 3.
13. Loading, empty, error, stale, `answers`, `ef-few` all render inside cards as §7.
14. Text contrast ≥ 4.5:1, marks/borders of controls ≥ 3:1 (computed at render); all targets ≥ 44px; focus ring visible on every control and chart.
