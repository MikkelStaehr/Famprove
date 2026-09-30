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
| Chart sr text | `Daglig fitness (CTL), træthed (ATL) og form (TSB) i TSS/dag fra tors. 1. jan. til ons. 30. sep.` · `Den ons. 30. sep.: fitness 45, træthed 41, form +4.` · `Fitness ændrede sig med +3 over de sidste 7 dage.` · `Styrkeblok 12: fra 14. sep., igangværende, deload-uge fra 5. okt.` · `Ingen styrkeblokke i perioden.` |
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

## 8. Explainer: lines, zones and today's reading (added 2026-09-30, M)
Question: "What do these three lines and five zones mean for my training?" No new data: the zone comes from `daily_load.form_zone` (`high_risk` · `optimal` · `grey_zone` · `fresh` · `transition` · `null`), never from comparing TSB in the UI. `ZoneBar` itself is **not changed** (shared with Today; Today stays as is).

### 8a. Zone reading (one sentence under the hero)
- New `/load`-only element after `ZoneBar` (hero), before the fitness delta. Spacing: 12px under the threshold numbers (or under ZoneBar's own "Zone ikke beregnet." line), then 8px to the fitness delta, which keeps its 4px to the detail line.
- `text-16` Barlow 400, `--text`, `max-width: 60ch`, wraps freely (≤ 2 lines at 390px; 200% text may wrap more, never truncates). No icon, no colour, no tint: the flag above already carries the zone name.
- Visible plain text, read in DOM order right after the hero sr sentence. No `aria-live` (it does not change after load).
- **No TSB** (`tsb` null): render nothing (ZoneBar already says "Form er ikke beregnet endnu.").
- Out of range: the zone's sentence as normal. Stale: unchanged (the updated line carries staleness). Loading: one extra skeleton bar (`text-16` height, w-3/4) between the threshold numbers and the delta bar.

| `form_zone` | Sentence (exact) |
|---|---|
| `high_risk` | `Du er langt mere træt, end din fitness kan bære. Tag lette dage, før du belaster igen.` |
| `optimal` | `Du er træt på den gode måde: belastningen bygger fitness op.` |
| `grey_zone` | `Du er hverken træt nok til at bygge fitness eller frisk nok til at præstere.` |
| `fresh` | `Du er frisk og klar til at præstere, men fitness bygges ikke op lige nu.` |
| `transition` | `Du er så frisk, at fitness falder. Fint i en pause, ellers er det tid til at træne.` |
| `null` (TSB exists) | `Uden zone kan dagens form ikke tolkes. Brug tallet på skalaen ovenfor.` |

### 8b. "Hvad betyder det?" disclosure (chart card)
- Placement: inside the chart card, **8px under the legend, 12px above the plot**. Native `<details>` (no `open` attribute: collapsed by default) with a `<summary>`. No JS, no custom ARIA: the browser exposes expanded/collapsed.
- Summary: full card width, `min-height: 44px`, flex, items centred, `text-16` Barlow 600 `--text`, sentence case. Default marker removed (`list-style: none` + `::-webkit-details-marker { display: none }`); a 20px chevron-down icon (`aria-hidden`, `--text-muted`) 8px after the text, rotated 180° when `[open]`: 180ms ease-out under `motion-safe` only, instant otherwise. Focus: Part B ring (3px `--focus`, 3px offset, `rounded-control`). No hover-only affordance. Accessible name: visible text + sr-only suffix, i.e. `Hvad betyder det?` + `<span class="sr-only"> Forklaring af fitness, træthed, form og formzoner</span>` (starts with the visible label, WCAG 2.5.3).
- Open body: `max-width: 65ch`, 8px under the summary, 16px bottom padding, 16px between groups, 12px between items. No inner boxes, no dividers (group by proximity). No height animation.
- **Group 1 – lines:** a `<dl>`. Term: the legend's line swatch (same solid/dashed/dotted mark and token as the legend, 24px, `aria-hidden`) + term in `text-16` 700. Description: `text-16` 400 `--text`, 4px below. Then the method note in `text-14` `--text-muted`.
- **Group 2 – zones:** `<h3>` `Formzoner` (`text-14` 700 uppercase +0.04em). Then a `<dl>`, one item per zone, in scale order (low to high). Term line: 12px `rounded-mark` swatch in `--zone-*` with a 1px `--text-muted` ring (`aria-hidden`), 8px gap, zone name `text-16` 700, then the range in `text-14` 600 tabular `--text-muted` on the same line (wraps under it at 200%). Range: visible text `aria-hidden` + an `sr-only` twin with "minus" written out. Description: `text-16` 400, 4px below.
- The disclosure renders whenever the chart card renders its legend (incl. chart empty/error). Page Empty/Error: no chart card, so no disclosure. Loading: a 44px row with a `text-16` bar w-1/3 in its place, so nothing jumps.
- Fold: closed, and with a 2-line zone sentence, the **240px plot** must still end ≤ 844px at 390px (this replaces §7.4's "chart card fully visible"). If it doesn't, report it; don't shrink type or move the disclosure.

| Key | Danish (exact) |
|---|---|
| Summary | `Hvad betyder det?` (+ sr-only ` Forklaring af fitness, træthed, form og formzoner`) |
| Term / text: Fitness | `Fitness (CTL)` · `Din gennemsnitlige daglige belastning over de sidste ca. 6 uger. Stiger langsomt og viser den kapacitet, du har bygget op.` |
| Term / text: Træthed | `Træthed (ATL)` · `Din gennemsnitlige daglige belastning over den sidste ca. uge. Svinger hurtigt og viser, hvor træt du er lige nu.` |
| Term / text: Form | `Form (TSB)` · `Fitness minus træthed. Negativ: du bygger op og er træt. Positiv: du er frisk.` |
| Method note | `Belastning er TSS pr. dag fra cykling og styrke tilsammen. Fitness og træthed er vægtede gennemsnit: de nyeste dage tæller mest, og ældre dage fylder gradvist mindre uden at forsvinde helt. Tidskonstanterne er 42 og 7 dage, samme formel som intervals.icu.` |
| Zones heading | `Formzoner` |
| Høj risiko | range `−30 og lavere` (sr `minus 30 og lavere`) · `Træthed langt over fitness. Risiko for overbelastning og sygdom, så læg lette dage ind.` |
| Optimal | range `over −30 til og med −10` (sr `over minus 30 til og med minus 10`) · `Træt nok til at bygge fitness uden at køre dig selv ned. Her skal en god træningsblok ligge.` |
| Gråzone | range `over −10 til under 5` (sr `over minus 10 til under 5`) · `Hverken træt nok til at bygge fitness eller frisk nok til at præstere.` |
| Frisk | range `5 til under 20` · `Udhvilet og klar til at præstere, fx til løb eller test. Fitness bygges ikke op.` |
| Overgang | range `20 og højere` · `Så frisk, at fitness falder. Fint i en pause mellem sæsoner, ellers er det tid til at træne mere.` |

All minus signs U+2212. Boundaries follow `python/src/training_load/domain/form.py`: −30 and −10 belong to the lower zone, 5 and 20 to the higher.

### 8c. Acceptance criteria (for `tester`)
1. For each `form_zone` value (`DEV_TODAY` on days in each zone, or a stubbed row) and for zone `null` with a TSB, `/load` shows exactly the §8a sentence directly under the hero ZoneBar and above the fitness delta; with TSB null no sentence appears. Today (`/`) is pixel-unchanged.
2. The disclosure is a native `<details>` directly under the legend, closed on load; its summary is ≥ 44px high, reachable by Tab, toggles with Enter and Space, shows the 3px focus ring, and the chevron does not animate under `prefers-reduced-motion: reduce`.
3. Opened, it shows every §8b string verbatim, including "vægtede gennemsnit" and "42 og 7 dage"; the zone ranges use U+2212 and match form.py's boundaries; no text is smaller than 14px.
4. At 390 × 844 with the disclosure closed, the chart plot ends ≤ 844px; at 200% text size nothing in the sentence or the open disclosure is clipped or overlaps, in light and dark.
5. A screen reader announces the summary as a collapsed/expanded control named "Hvad betyder det? Forklaring af fitness, træthed, form og formzoner", and reads the ranges with "minus".
