# Spec-lite – Belastning (`/load`)

Owner: design-lead · 2026-09-30 · for `ui`. Contract: `DESIGN.md` Part A + Part B (Spurt), pattern pack `design/patterns/data-dashboard.md` (structure). Language and number rules as `design/specs/today.md` (top): Danish UI, `ons. 30. sep.`, `kl. 05.03`, decimal comma, U+2212, never translate TSS/W/FTP/CTL/ATL/TSB, block tab names or activity names.

## 1. Question and primary action
- "How loaded am I right now, and is fitness going up?"
- No primary action (read-only). The only controls are the nav and the week switcher.

## 2. Hierarchy at 390 × 844
1. Nav, then h1 "Belastning" (`text-44` display, uppercase via CSS), updated line (as Today, §3).
2. **Hero: ZoneBar, hero size** (DESIGN.md Part B › Zone bar), 12px under the updated line, directly on `--bg` (no card). The flag value is `text-56` Condensed 800 italic tabular: **the largest text on `/load`**. Replaces `KeyFigure` + `StatusBadge`.
   - Under the threshold numbers, 12px: the **fitness delta** (`text-16` 600, arrow icon + words, tone as today) and then the **detail line** (`text-14` `--text-muted`, 4px below).
3. **Chart card** "Fitness, træthed og form" (card title `text-20` Barlow 700, sentence case): legend, then the 240px chart. Fully visible at 390 × 844 (estimate: hero ends ≈ y 330, chart card ends ≈ y 730).
4. Week card below the fold.

## 3. Chart
- Series unchanged (Part B tokens: CTL ink solid, ATL dashed, TSB dotted blue). Strength-block shading and deload hatch stay.
- **No zone band shading** on the chart: CTL, ATL and TSB share one TSS/dag axis, so bands would put a CTL of 45 in "Overgang". The ZoneBar above is the zone view.
- Axis: `text-12`, unit "TSS/dag" on the y axis; x ticks as months `jan.` … `okt.`.

## 4. Copy (hero, chart, page)
| Key | Danish (exact) |
|---|---|
| h1 / document title | `Belastning` |
| Updated, stale | `Forældet: sidst opdateret 28. sep. kl. 05.03. Jobbet skal køre dagligt omkring kl. 05.00.` |
| Updated, unknown | `Opdateringstidspunkt ukendt, så data kan være forældet.` |
| ZoneBar label line | `FORM (TSB)` · `TSS/dag` |
| Zone names | `Høj risiko` · `Optimal` · `Gråzone` · `Frisk` · `Overgang` |
| Fitness delta | `Fitness stiger: +3 på 7 dage` · `Fitness falder: −2 på 7 dage` · `Fitness uændret over 7 dage` · `Fitness-trenden kræver 7 dages data` |
| Detail line | `Fitness (CTL) 45 − træthed (ATL) 41` (decimals, if any, with comma) |
| No TSB (ZoneBar) | `Form er ikke beregnet endnu.` |
| Zone null | `Zone ikke beregnet.` |
| Empty (no rows) | `Der er ikke beregnet nogen træningsbelastning endnu. Det daglige job udfylder den omkring kl. 05.00.` |
| Load error | title `Kunne ikke hente træningsdata`, `what` from `describeDataError` (Today §5a), `Prøv igen` → `/load` |
| Chart card title | `Fitness, træthed og form` |
| Legend (aria `Forklaring`) | `Fitness (CTL)` · `Træthed (ATL)` · `Form (TSB)` · `Styrkeblok` · `Deload-uge` |
| Tooltip | `ons. 30. sep.` · `Fitness (CTL) 45` · `Træthed (ATL) 41` · `Form (TSB) +4` · `Program - blok 12 (offseason)` (as written) + ` · deload` in a deload week |
| Chart empty | `Trenden vises, når der er mindst to dages træningsbelastning.` |
| Chart error | title `Grafen kan ikke vises`, `Grafen kunne ikke tegnes. Tallene ovenfor er ikke berørt.` + `Prøv igen` |
| Chart sr text | `Daglig fitness (CTL), træthed (ATL) og form (TSB) i TSS/dag fra tor. 1. jan. til ons. 30. sep.` · `Den ons. 30. sep.: fitness 45, træthed 41, form +4.` · `Fitness ændrede sig med +3 over de sidste 7 dage.` · `Styrkeblok 12: fra 14. sep., igangværende, deload-uge fra 5. okt.` · `Ingen styrkeblokke i perioden.` |
| Chart sr table (if a table is used) | caption `Fitness, træthed og form pr. dag`; columns `Dato` · `Fitness (CTL)` · `Træthed (ATL)` · `Form (TSB)` · `Styrkeblok` |

**Hero sr sentence** (one `sr-only` sentence, the same component and wording as Today §5a):
| Case | Sentence |
|---|---|
| Høj risiko | `Form minus 34 TSS per dag: høj risiko, under minus 30.` |
| Optimal | `Form minus 12 TSS per dag: optimal, som går fra minus 30 til minus 10.` |
| Gråzone | `Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5.` |
| Frisk | `Form plus 11 TSS per dag: frisk, som går fra 5 til 20.` |
| Overgang | `Form plus 24 TSS per dag: overgang, over 20.` |
| No zone | `Form plus 4 TSS per dag. Zone ikke beregnet.` |
| Out of range (< −40 or > 30) | zone sentence + ` Uden for skalaen, som går fra minus 40 til 30.` Visually: the marker is pinned to the bar end with an 8px outward chevron; the flag shows the true value (e.g. "−46"). |

## 5. States
| State | Treatment |
|---|---|
| Loading (`app/load/loading.tsx`) | h1 real; updated bar; hero ZoneBar skeleton: label line real, 72px blank (flag + notch), 5 `--track` bands at their spans, threshold numbers real, two text bars (`text-16` w-1/2, `text-14` w-2/3); chart card with real title, legend bar and a 240px `--track` block; week card skeleton unchanged. Pulse under `motion-safe` only. |
| Empty | EmptyState (copy above) in place of hero + chart; nav and h1 stay. |
| Error | ErrorState in place of hero + chart; retry `/load`. |
| Stale | Updated line in `--warning` + icon; hero and chart unchanged. |
| No TSB / zone null / out of range | ZoneBar states (DESIGN.md Part B). |

## 6. Week card copy (DEFERRABLE: follow-up if over budget)
Structure unchanged (DESIGN.md › Week card).
| Key | Danish (exact) |
|---|---|
| Card title | `Denne uge · uge 40` (latest) · `Uge 39` (others) · `Denne uge` (no week) |
| Card action link | `Tilbage til denne uge` |
| Switcher aria | `Forrige uge: uge 39` · `Næste uge: uge 41` (year only when not the current: `uge 52 2025`) · nav aria `Vælg uge` |
| Switcher label | `21.–27. sep. · 2026-W39` + ` · 3 af 7 dage indtil videre` (latest) / ` · 3 af 7 dage med data` |
| Column heads | `Cykel` · `Styrke` · `I alt` |
| Week total | `Uge 39 i alt` |
| Rest row | `Hvile` |
| Strength section | `Session 2 · Program - blok 12 (offseason) · uge 1` · `Styrke · ikke i programmet` · `Styrke 1:12:48 · 86 TSS` |
| Ride metrics | `Bevægelsestid` · `Kilde` · `Ukendt enhed` · `Tur uden navn` |
| Missing values | `–`, spoken `ikke registreret` · blank kg: `intet kg logget` · score label `score pr. sæt (før styrkefaktor)` |
| Row sr | `cykling 86 TSS, styrke 0 TSS, i alt 86 TSS` |
| Empty | `Ingen ugetotal for denne uge endnu.` · `Ingen træningsdage registreret i uge 39.` |
| Error | `Kunne ikke hente ugens træninger` + `describeDataError` + `Prøv igen` |

## 7. Acceptance criteria (for `tester`)
1. The hero flag value computes to 56px and is the largest text on `/load`; there is no `KeyFigure` or zone `StatusBadge` left.
2. The hero shows "FORM (TSB)", "TSS/dag", the Danish zone name in the flag, five bands with the active one outlined (from `form_zone`), thresholds −30/−10/5/20, then the delta line and "Fitness (CTL) … − træthed (ATL) …".
3. The hero sr sentence matches §4 for every band, no-zone and out-of-range; with TSB −46 the marker sits at the left end with a chevron and the flag reads "−46".
4. The chart has no zone shading; block shading and deload hatch remain; the legend and tooltip are Danish; the chart card is fully visible at 390 × 844.
5. Card titles on `/load` are 20px Barlow 700, sentence case.
6. No English UI string remains in the hero, chart, page chrome or states (week card: after the §6 follow-up).
