# Spec – Analyse (`/analyse`), section Cykel

Owner: design-lead · 2026-10-01 · task d (L) · for `ui`. Contract: `DESIGN.md` Part A + Part B (Spurt), pattern pack `design/patterns/data-dashboard.md` (structure). Language and number rules as `design/specs/today.md` (top): Danish UI, `tirs. 3. jun.`, `kl. 05.03`, decimal comma, U+2212, en-dash ranges, never translate W/NP/FTP/eFTP/EF/TSS. **The year is added to every date outside the current year** (`tirs. 3. jun. 2025`); the window spans two years.

Data: `ride_metrics` and `cycling_weeks`, read server-side through `web/src/lib/db/*`, plotted as given. The UI never computes a training metric: no medians, no eFTP picking rules, no deltas. Allowed: sorting and filtering rows, counting rows, date to x position, and choosing a y domain.

## 1. Question and primary action
- **Question:** "Bliver jeg bedre på cyklen?" ("Am I getting fitter on the bike?")
- **No primary action** (read-only). The controls are the nav, chart tooltips (tap) and one disclosure.
- **Cut:** strength, the combined view, per-ride detail pages, zones, power curves, filters and date pickers.

## 2. Route, nav, section heading
- `/analyse`, document title `Analyse`. Skeleton: `app/analyse/loading.tsx`.
- **ScreenNav gets a third link**, `Analyse` → `/analyse` (`I dag` · `Belastning` · `Analyse`). The look is unchanged. The grid becomes `repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr))`, so all three fit on one row at 390px ("Belastning" ≈ 110px in a ≈ 116px column) and they stack at 200% text without horizontal scroll.
- **Section heading:** `h2` "Cykel", `text-32` Barlow Condensed 800 italic, uppercase via CSS (the same "CYKEL" as Today's ride card), 16px under the updated line. **No tablist and no tab roles** while Cykel is the only section.
  - *Later (Styrke task):* a section tab strip replaces the visible h2 in this same slot, and the panel keeps an `sr-only` h2. It must not reuse ScreenNav's pill look, because two pill strips stacked read as one menu. Nothing below the slot changes.

## 3. Layout (390px first; 1280 = the same single column, max 720px, Part B)
1. Nav, h1 `Analyse` (`text-44` display, date not shown), `UpdatedLine` 4px under it.
2. h2 `Cykel` (§2).
3. **Hero: eFTP key figure**, 12px under the h2, directly on `--bg` (no card, as the `/load` hero):
   - Label line (`flex-wrap`, space-between): `Estimeret FTP` (`text-14` 700 uppercase +0.04em) · `fra tirs. 15. sep.` (`text-14` 600 `--text`, as Today's "fra …" date).
   - 8px, then the value `184 W` in `text-56` Condensed 800 italic tabular, W the same size. **The largest text on the page.**
   - 12px, then the delta line (`text-16` 600 `--text` + a 16px up/down/flat arrow, `aria-hidden`). It is neutral, never red or green, as on `/load`: a lower eFTP after the offseason is expected, and the words carry the direction.
   - 4px, then the detail line (`text-14` `--text-muted`). 8px, then the honesty note (`text-14` `--text-muted`, `max-width: 60ch`).
4. **Card "eFTP pr. tur"** (`text-20` Barlow 700, sentence case, as on `/load`): legend, the unit `W` (`text-12` muted, as "TSS/dag"), then the plot at `--chart-height`. **Fold:** at 390 × 844, the hero and this plot, including its x labels, end at or above 844px (estimate: hero ends ≈ y 350, plot ≈ y 720).
5. **Card "Effektivitet på rolige ture"**: an explainer line (`text-14` muted, 60ch), legend, the unit, then the plot at `--chart-height` or the too-few block (§5c).
6. **Card "Timer og belastning pr. uge"**: legend, then two stacked strips with a shared x axis (§5d).
7. **Excluded rides**: a disclosure card (§5e), collapsed.

Stack gap 16px, card padding as Part B. Inside cards: legend 8px under the title, plot 8px under the unit label, notes 8px under the x labels.

## 4. Shared time axis and the pause seam (the screen's signature)
- **One x domain for all three charts:** 1 Jan 2025 to today (`DEV_TODAY` or the local date), padded half a day at each end. Because all charts share the domain, the same date sits at the same x in every card.
- **Ticks** (`text-12` muted, tabular). Below 640px: 1 Jan and 1 Jul of each year → `jan. 2025` `jul.` `jan. 2026` `jul.`. From 640px: quarterly → `jan. 2025` `apr.` `jul.` `okt.` `jan. 2026` …. The year appears on January ticks only, and the first label is start-anchored.
- **Pause seam:** every run of **≥ 4 consecutive `cycling_weeks` rows with `rides = 0`** gets a seam, drawn the same way in all three charts.
  - Each edge of the run (its first Monday, and the Monday after its last week) gets a 1px dashed (3 3) `--chart-mark` vertical rule, full plot height.
  - The label `Ingen ture` (`text-12` 500 `--text-muted`) is centred over the run in an 18px strip at the top of the plot. Omit the label, not the rules, when the run is narrower than the label.
  - No fill: on `/load`, fills already mean prognose, block and deload.
  - In the live data, the seams are Jan–Feb 2025 and Oct 2025–Feb 2026. Seen down the page, the offseason reads as one honest pause, not three broken charts.
- **"You are here" (`--slab`):** the latest eFTP point and the current week's bars. Nothing else in these charts uses `--slab`.
- No motion: `isAnimationActive={false}` everywhere, as on `/load`.
- Reuse the `/load` building blocks: Recharts `ComposedChart`, the hydration skeleton, `catchError` → ErrorState, `LineSample`-style legend swatches, `TICK`, and the tooltip container (`rounded-control`, `max-w-72`). Extract shared pieces rather than copy them. No new chart library.

## 5. Charts

### 5a. Exclusion marks (eFTP and EF charts)
An excluded ride is **never hidden**. It is drawn as a **hollow 7px circle** (`--surface` fill, 1.5px `--text-muted` ring) on the plot's bottom edge at its date, not at a y value, because its value is the reason it was left out. It appears in each chart its reason removes it from:

| `exclusion` | eFTP chart | EF chart | Short reason (tooltip, list) | Explanation (list) |
|---|---|---|---|---|
| `too_short` | yes | yes | `For kort` | `Under 5 min eller 1 km. Ikke med i eFTP og EF.` |
| `power_outlier` | yes | yes | `Usandsynlige watt` | `Watt-målingen ser forkert ud. Ikke med i eFTP og EF.` |
| `hr_outlier` | no | yes | `Usandsynlig puls` | `Gennemsnitspulsen er under 80 eller over 200. Ikke med i EF.` |
| `no_raw` | yes | yes | `Ikke hentet endnu` | `Turens detaljer er ikke hentet endnu. Det daglige job henter dem.` |

The mapping lives in one view-model constant with a `node --test` test. An unknown code shows `Udeladt` with no explanation (never a guessed reason).

### 5b. eFTP pr. tur
- **Points:** every row with `eftp_ok`, at (`date`, `rolling_ftp_w`): a 5px `--text` dot. The **latest** point is 9px `--slab` with a 2px `--surface` ring.
- **Line:** 2.5px solid `--text` through the points in date order. It **breaks before every point with `eftp_gap_before = true`** (no segment from the previous point, nothing carried forward). Recharts: insert a null row, `connectNulls={false}`.
- **Y:** W, whole numbers, 3–4 ticks. The domain is zoomed to the points, rounded out to 10 W (visible axis, pack rule).
- **Legend:** `eFTP` (line + dot swatch) · `Udeladt tur` (hollow circle swatch).
- **Note under the plot** (only when such rides exist): `3 ture uden watt er ikke med her, men tæller i timer og belastning.` (1: `1 tur uden watt er …`). These are rides with `exclusion` null and `eftp_ok` false.
- **< 2 points:** EmptyState in place of the plot: `Trenden vises, når der er mindst to ture med watt.`

### 5c. Effektivitet på rolige ture (EF)
- **Explainer line** (always): `EF er normaliseret watt (NP) delt med gennemsnitspuls. Stiger den, træder du flere watt for samme puls. Kun rolige ture på mindst 30 min med både watt og puls.` (It does not name the endurance filter, which is still undecided.)
- **Points:** rows with `ef_ok`, at (`date`, `ef`): 6px filled `--chart-mark` dots (secondary: single rides scatter).
- **Trend:** `ef_trend` as a 2.5px solid `--text` line (the answer). It breaks before rows with `ef_gap_before = true`, and rows with a null `ef_trend` have no trend.
- **Y:** `EF (W pr. slag/min)` as the unit label; 2 decimals with a comma (`1,24`); domain zoomed and rounded out to 0,05.
- **Legend:** `Trend (median over 28 dage)` · `Tur` · `Udeladt tur`.
- **Too few: fewer than 5 `ef_ok` rows.** No axes. In place of the plot, a block at its natural height:
  - heading `For få rolige ture til en trend` (`text-16` 600)
  - text (`text-14` muted, 60ch):
    - 0: `Der er ingen rolige ture med både watt og puls siden 1. jan. 2025. Trenden vises, når der er mindst 5.`
    - 1: `Der er kun 1 rolig tur med både watt og puls siden 1. jan. 2025. Trenden vises fra 5.`
    - n: `Der er kun 3 rolige ture med både watt og puls siden 1. jan. 2025. Trenden vises fra 5.`
  - With 1–4, a list follows (`text-16`, tabular, newest first): `tirs. 3. jun. 2025 · EF 1,24`. The data is shown, not hidden.

### 5d. Timer og belastning pr. uge
- **Two strips, no dual axis** (pack rule). The top strip is `Timer` (unit `t`), the bottom `Belastning` (unit `TSS`), each 112px tall with an 8px gap. Strip labels are `text-14` 600 with the unit in muted. Both y axes start at 0. Only the bottom strip has x labels.
- **One mark per `cycling_weeks` row**, at `week_start` (a 7-day slot):
  - `rides > 0`: a `--text-muted` bar (`moving_s` as hours / `load`), width = slot − 1px, square ends.
  - `rides = 0`: a **zero tick**, a 2px-tall `--chart-mark` mark on the baseline. Gaps show as a dotted baseline, never as empty space.
  - The current ISO week: `--slab` instead of `--text-muted`.
  - `load` null in a week with rides: no mark in the load strip (missing is not zero). The tooltip says why.
  - A week missing from `cycling_weeks`: no mark at all.
- **Legend:** `Uge med ture` (bar) · `Denne uge` (slab) · `Uge uden ture` (zero tick).
- **Error** (`cycling_weeks` read fails, `ride_metrics` OK): ErrorState inside this card, `Kunne ikke hente ugerne` + `describeDataError` + `Prøv igen` → `/analyse`. The hero and the trends are unaffected.

### 5e. Udeladte ture (disclosure card)
- A native `<details>`, closed by default, styled exactly like `/load` §8b (44px summary, `text-16` 600, chevron, focus ring, no height animation).
- **Summary:** `7 ture udeladt fra trends` (1: `1 tur udeladt fra trends`). It counts rows with `exclusion` non-null.
- **Body:**
  - First `De tæller stadig med i timer og belastning.` (`text-14` muted).
  - Then a `<ul>`, newest first, 12px between items:
    - line 1 (`text-16` 600): `tirs. 3. jun. 2025 · For kort`
    - line 2 (`text-14` `--text`): the explanation from §5a
    - line 3 (`text-14` muted, tabular): the facts the reason is about: `4 min · 0,8 km` · `NP 31 W · 1:37 t` · `puls 212 · 1:10 t`
  - A null value drops its fact (never "0").
- **0 excluded:** no disclosure. In its place: `Ingen ture udeladt fra trends.` (`text-14` muted).

## 6. Copy (exact)
| Key | Danish |
|---|---|
| Nav link / h1 / title | `Analyse` |
| Section h2 | `Cykel` |
| Updated, stale, unknown | the `UpdatedLine` strings from `load.md` §4, unchanged |
| Hero label · date | `Estimeret FTP` · `fra tirs. 15. sep.` |
| Delta (needs data, §9) | `eFTP stiger: +12 W på et år` · `eFTP falder: −49 W på et år` · `eFTP uændret på et år` (delta 0) · `Ingen eFTP fra samme tid sidste år at sammenligne med` |
| Detail | `Samme tid sidste år: 233 W (fre. 12. sep. 2025)` |
| Honesty note | `eFTP er et skøn fra intervals.icu ud fra dine hårdeste indsatser, ikke et testresultat. Uden maksimale indsatser ligger den ofte for lavt.` |
| Hero, no eFTP | in place of the value, `text-16` muted: `Ingen ture med watt siden 1. jan. 2025, så der er ingen eFTP endnu.` Delta and detail are omitted; the note stays |
| Card titles | `eFTP pr. tur` · `Effektivitet på rolige ture` · `Timer og belastning pr. uge` |
| Tooltip, eFTP ride | `tirs. 3. jun. 2025` · `eFTP 212 W` · `Udendørs tur · 1:45 t · 48,2 km · NP 182 W` (`VirtualRide`: `Virtuel tur`) |
| Tooltip, EF ride | date · `EF 1,24` · `Trend 1,22` (if `ef_trend`) · `NP 165 W · puls 133 · 1:45 t` |
| Tooltip, excluded | date · `Udeladt: For kort` · the §5e facts line |
| Tooltip, week | `Uge 23 · 2.–8. jun. 2025` · `3 ture · 4:30 t · 210 TSS` · `1 udeladt fra trends` (if > 0) · zero week: `Ingen ture` · null load: `Belastning ikke beregnet` · current: first line + ` · indtil videre` |
| Missing value | `–`, spoken `ikke registreret` |
| Page empty | `Der er ingen cykelture siden 1. jan. 2025 endnu. Det daglige job henter dem omkring kl. 05.00.` |
| Page error | title `Kunne ikke hente cykeldata`, `describeDataError`, `Prøv igen` → `/analyse` |
| Chart error | `Grafen kan ikke vises` · `Grafen kunne ikke tegnes. De andre tal på siden er ikke berørt.` + `Prøv igen` |

Hours `h:mm t` (as Today's `I alt 1:15 t`); under 1 h, `45 min`. Distance in km, 1 decimal. W whole numbers. EF 2 decimals.

## 7. Screen-reader text (a figcaption per chart, as `/load`)
- **Hero:** one `sr-only` sentence: `Estimeret FTP 184 watt den tirsdag 15. september. Et år før: 233 watt, minus 49 watt.` (Without a comparison: only the first sentence.)
- **eFTP:**
  - `eFTP fra intervals.icu for 38 ture med watt fra 1. jan. 2025 til 1. okt. 2026. Seneste 184 W den 15. sep. 2026, højeste 233 W den 12. sep. 2025, laveste 181 W den 2. apr. 2026.`
  - Then one sentence per break: `Pause uden punkter fra 30. sep. 2025 til 10. mar. 2026.`
  - Then `7 ture er udeladt; se listen Udeladte ture.`
- **EF:** `EF på 11 rolige ture fra … til …. Seneste trend 1,22 den …, seneste tur 1,24.` In the too-few case, the visible text is the alternative.
- **Weekly:** an `sr-only` `<table>`, caption `Cykling pr. uge`. Columns `Uge` · `Ture` · `Timer` · `Belastning (TSS)` · `Udeladt fra trends`, one row per `cycling_weeks` row.

The seam label and the marks are `aria-hidden`; the sentences carry them. Write "minus", not "−", in sr text.

## 8. States
| State | Treatment |
|---|---|
| Loading | h1, h2 and card titles are real. Updated bar; hero skeleton: label line real, a 56px bar (w-1/3), two text bars; `--track` blocks at `--chart-height`, `--chart-height`, and 2 × 112 + 8; a 44px bar for the disclosure. Pulse under `motion-safe` only. |
| `DEV_FIXTURE=empty` (no `ride_metrics` rows) | Page-empty EmptyState in place of the hero and all cards; nav, h1 and h2 stay. |
| `DEV_FIXTURE=error` (`ride_metrics` fails) | Page-error ErrorState in the same place. |
| `DEV_FIXTURE=stale` / real stale | The freshness time is the **older** of max(`ride_metrics.computed_at`) and max(`cycling_weeks.computed_at`). Older than 26 h: `UpdatedLine` in `--warning` + icon, data unchanged. The stale fixture ages both tables. |
| EF too few (< 5 `ef_ok`) | §5c block; live today with either filter variant at 0 points. |
| `DEV_FIXTURE=ef-few` (new, dev only) | Real rows with `ef_ok` kept only on the latest 3, so the too-few block with a list can be screenshotted. Ignored in production. |
| eFTP < 2 points / no eFTP | §5b empty and the §6 hero no-eFTP text. |
| Weekly read fails | §5d card error. |
| 0 excluded | §5e line. |
| Dark, 200% text | Tokens' dark values. At 200% the hero, legends, notes, tooltips and the list wrap without clipping. The SVG tick labels stay 12px (accepted as `/load` §9d). |
| Reduced motion | Nothing animates (only the disclosure chevron, which follows `/load` §8b). |

## 9. Needs data (Python, part A): done as columns on `ride_metrics`
The hero comparison is a computation, so Python owns it. Part A put it on every `eftp_ok` row of `ride_metrics` (no separate table):
- the hero is the **latest `eftp_ok` row**: `rolling_ftp_w` + `date`;
- `eftp_year_ago_w`, `eftp_year_ago_date`: the latest `eftp_ok` point 365–386 days before that row's date, else null;
- `eftp_delta_w`: `rolling_ftp_w − eftp_year_ago_w`, or null (null together with the year-ago fields).

Picking the latest `eftp_ok` row is selection, not arithmetic; the delta is shown as delivered.

## 10. Acceptance criteria (design review + `tester`)
1. **Nav:** three links in one row at 390px (100% text) with `Analyse` `aria-current="page"` on `/analyse`; at 200% text they stack with no horizontal scroll. `/` and `/load` are otherwise pixel-unchanged.
2. **Heading:** h1 `Analyse`, h2 `Cykel`; there is no `role="tab"`/`tablist` and no Styrke/Samlet placeholder anywhere.
3. **Hero:** the eFTP value computes to 56px and is the largest text; the delta and detail come verbatim from `cycling_summary` (no arithmetic: a `node --test` on the view model passes `eftp_delta_w` through), and the honesty note is present.
4. **Fold:** at 390 × 844, light and dark, the eFTP plot including its x labels ends at or above 844px.
5. **eFTP line:** there is no segment across any point with `eftp_gap_before`, and none across Oct 2025–Feb 2026. The latest point is the 9px `--slab` dot.
6. **Seams:** in the live data, `Ingen ture` seams sit at identical x in all three charts (overlay the 390 and 1280 screenshots).
7. **Exclusions:** every row with `exclusion` appears as a hollow baseline mark in the charts §5a assigns, and in the disclosure with its Danish reason and facts. The summary count equals those rows. `no_raw` and an unknown code render without guessing.
8. **EF:** with `DEV_FIXTURE=ef-few` the too-few block shows `Der er kun 3 …` plus 3 list rows, with no axes. With ≥ 5 points the chart shows dots and a broken trend line.
9. **Weekly:** every `cycling_weeks` row has a bar or a zero tick in both strips (except a null load); the current week is `--slab`; the Oct 2025–Feb 2026 gap reads as a dotted baseline; the sr table has one row per week.
10. **States:** `empty`, `error`, `stale`, `ef-few`, 1280, dark and 200% text screenshots via `run-web`, with every §6 string verbatim and no English UI string.
