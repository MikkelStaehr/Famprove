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
| Høj risiko | `Form minus 34 TSS per dag: høj risiko, minus 30 og lavere.` |
| Optimal | `Form minus 12 TSS per dag: optimal, som går fra minus 30 til minus 10.` |
| Gråzone | `Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5.` |
| Frisk | `Form plus 11 TSS per dag: frisk, som går fra 5 til 20.` |
| Overgang | `Form plus 24 TSS per dag: overgang, 20 og højere.` |
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

## 9. Today-centred chart with prognose (added 2026-09-30, L · Feature A)
Question: "Where am I today, and where does my usual training take fitness in the next 8 weeks?" Data: `daily_load` (measured) + `daily_projection` (Python). The UI never computes a projection. **Supersedes** §3's month ticks and "since 1 Jan", §2.3's 240px and §8b/§8c's fold line. Everything else in §3 and §8 stays as built.

### 9a. Window, fold, axis
- **Window:** `today − 56` … `today + 56` days (`today` = `DEV_TODAY` or the local date). Measured rows and block shading are clipped to the window's left edge. The y domain covers measured and projected values.
- **Measured vs prognose:** measured lines run up to the latest `daily_load` date (`lastActual`). Projection rows are drawn only when `date > lastActual`. The first projection point joins the `lastActual` point, so there is no gap. Block shading and the deload hatch stop at `lastActual` (no future blocks are stored).
- **Fold fix:** below 640px `--chart-height` = **224px** (240px from 640px). This absorbs the 12px overrun plus 4px of margin. Type, spacing and the disclosure stay where they are. The row in DESIGN.md's token table follows (design-lead).
- **Annotation strip:** the top 24px of the plot is headroom (y domain padded, no gridline label there). The "i dag" and prognose labels sit in it.
- **X ticks** (`text-12`, `--text-muted`, tabular, format `5. aug.`, no weekday): below 640px, 5 ticks at today −56, −28, 0, +28 and +56. From 640px, 9 ticks every 14 days, anchored on today. The first label is start-anchored and the last end-anchored, so none are clipped. Today's tick label is 600 `--text`. Without projection rows, the ticks stop at 0.

### 9b. "i dag" marker and prognose region
- **"i dag" rule:** 1px solid `--text` vertical line at today, running the full plot height. It sits above the region fill and block shading and below the series. Label `i dag`: `text-14` 600 `--text` in the strip, end-anchored 4px left of the rule, on a `--surface` backing (`rounded-mark`, 2px/4px padding) so that lines never cut through it. On today, each series gets a 7px dot in its series colour with a 2px `--surface` ring (it ties the chart to the hero).
- **Prognose region:** from `lastActual` to the right edge, fill `--track` at **60% opacity**, drawn behind the lines. Series keep their full colour, width and dash (ATL dashed, TSB dotted, as Part B). **Do not** lower line opacity: ATL at 55% falls to 2.5:1. Line contrast on the fill: light ≥ 4.3:1, dark ≥ 5.1:1. The fill is supplementary. The meaning is carried by the label, the rule, the legend, the tooltip and the sr text.
- **Region label** `Prognose · anslået`: `text-14` 600 `--text-muted` in the strip, start-anchored 6px right of the rule (≥ 6:1 on the fill). At 200% text it wraps to two lines (`Prognose ·` / `anslået`), and the strip grows with it. Never truncated. If `lastActual` < today (stale), the region begins left of the rule and the label stays right of the rule.
- **Legend:** no prognose item (review 2026-09-30: as a legend item it wrapped to a 3rd line and broke the fold by ~14px). The region label is the key, placed right beside the fill. The swatch (24×12, `--track` 60% fill, 1px `--chart-mark` ring) appears only in the disclosure term below. The legend stays at 2 lines at 390px.
- **Disclosure (§8b group 1):** add a 4th term after Form, with the legend swatch. Term `Prognose (anslået)`, text (rewritten 2026-10-01, §10): `Fitness, træthed og form de næste 8 uger, hvis du træner som du plejer. Cykling: dit gennemsnit for hver ugedag de sidste 28 dage (en planlagt tur erstatter dagen). Styrke: resten af blokken ud fra trænerens plan, og efter blokken dit gennemsnit pr. uge fra de seneste 4 hele uger uden deload. Det er et skøn, ikke en plan.` A 5th term (`Spænd efter blokken`) follows, see §10a.
- No motion: the chart, the rule and the region never animate.

### 9c. Tooltip on a prognose day (same component; values tabular, U+2212)
| Line | Danish (exact) |
|---|---|
| Date | `tors. 8. okt.` |
| Status (`text-14` 600 `--text-muted`) | `Prognose` · `Prognose · dag anslået` when any placement on that day is estimated (`basis` day-estimated flag) |
| Values | `Fitness (CTL) ≈ 46` · `Træthed (ATL) ≈ 44` · `Form (TSB) ≈ +2` |
| Basis, cycling | `Cykel ≈ 62 TSS · typisk torsdag` · `Cykel 80 TSS · planlagt tur` · line omitted when 0/none |
| Basis, cycling, planned ride unreadable (source falls back to typical) | `Cykel ≈ 62 TSS · typisk torsdag (planlagt tur kunne ikke læses)` |
| Basis, strength | Superseded by §10c (method, range and the three reasons). |

Measured days keep the §4 tooltip, with no "≈". Today's tooltip is measured. Status, values and strength lines on prognose days: §10c.

### 9d. Screen-reader text (extends §4 "Chart sr text")
- Range sentence: `Daglig fitness (CTL), træthed (ATL) og form (TSB) i TSS/dag fra ons. 5. aug. til ons. 30. sep., og en anslået prognose til ons. 25. nov.` (without projection: the text up to `30. sep.`).
- Added after the today sentence: the prognose sentence in §10d (replaces `Prognose, anslået ud fra en typisk uge: …`).
- No sr table (review 2026-09-30): the chart has none (§4 made it optional). The three sentences carry the chart's purpose (range, today, where the prognose ends). If a table is added later, it gets a `Type` column (`Målt` · `Prognose` · `Prognose, dag anslået`), and prognose cells get a `ca.` prefix.
- At 200% text the SVG tick labels stay 12px. Browser zoom scales them with the plot, so that is accepted. Labels must not overlap at 100% text.

### 9e. States
| State | Treatment |
|---|---|
| No projection rows (none, or all dates ≤ `lastActual`) | Window ends at today. No region, no region label, no legend item. The "i dag" rule sits at the right edge with its label end-anchored. Note under the plot, 8px, `text-14` `--text-muted`: `Ingen prognose endnu. Den beregnes af det daglige job omkring kl. 05.00.` |
| Projection read fails, `daily_load` OK | As above, with the note `Prognosen kunne ikke hentes, så grafen viser kun målte dage. Genindlæs siden for at prøve igen.` in `--warning` + alert icon. The hero is unaffected. |
| `DEV_FIXTURE=empty` / `error` | Page states as §5. No projection is read or drawn. |
| `DEV_FIXTURE=stale` / real stale | Updated line as §5. Region from `lastActual` (left of the rule), label unchanged. |
| Chart empty (< 2 measured days) | §4 chart-empty copy. The prognose is never drawn alone. |
| Loading | §5 skeleton, with the block at `--chart-height` (224px below 640). |

### 9f. Acceptance criteria (for `tester`)
1. At 390 × 844 (disclosure closed, 2-line zone sentence, light and dark) the plot including the x labels ends ≤ 844px. The plot is 224px high below 640px and 240px from 640px. No text size changed.
2. With `DEV_TODAY=2026-09-30` the x axis runs 5. aug. → 25. nov. The 390px ticks read `5. aug.` `2. sep.` `30. sep.` `28. okt.` `25. nov.`, with no label clipped. A 1px solid rule labelled `i dag` sits at 30. sep.
3. Right of `lastActual` a `--track` 60% region is labelled `Prognose · anslået`. Series keep the Part B colour and dash (no reduced line opacity). Block shading and the deload hatch end at `lastActual`. The legend has no prognose item and is 2 lines at 390px. The disclosure term `Prognose (anslået)` keeps the swatch.
4. The tooltip on a future day follows §9c verbatim: date, `Prognose`, values with `≈`, then the cycling/strength basis lines. On a day whose `basis` flags an estimated placement the status reads `Prognose · dag anslået`. Measured days show no `≈`.
5. Projection rows dated ≤ the latest `daily_load` date are never drawn. With no projection rows the chart ends at today and shows the §9e note. With `DEV_FIXTURE=empty|error` no prognose appears anywhere.
6. The sr text includes the prognose sentence with "cirka" and "plus"/"minus" (no sr table required). At 200% text the region label wraps and never overlaps the `i dag` label or the lines' annotation strip.

## 10. Prognose uncertainty band after the block (added 2026-10-01, M · task 1b)
Question: "How sure is the prognose, and from where on is it a guess?" Data: `daily_projection` adds `ctl_low/ctl_high`, `atl_low/atl_high`, `tsb_low/tsb_high` (null inside the block) and `strength_method` (`plan` | `recent`); `basis.strength` entries gain `method`, `reason`, `tss_low/tss_high`, `recent_weeks`, `unscored`. The web selects these through `web/src/lib/db/*` and draws them as given: **no band arithmetic in the UI** (no widening, no smoothing, no deriving low/high). §9 stays as built except where it points here.

### 10a. The band (chart, 390px first)
- **One band, on CTL only.** It is the line the page's question is about. ATL sits close to CTL (two bands would overlap into one grey mass in a 224px plot), and the TSB/ATL ranges are in the tooltip and sr text instead.
- **Fill:** area between `ctl_low` and `ctl_high`, new token `--prognose-band` (light `rgb(18 18 18 / .16)`, dark `rgb(238 241 245 / .18)`; DESIGN.md token table), no edge strokes. Drawn above the `--track` region fill, below the series lines and the "i dag" rule. Only rows with both values non-null get the band, so it starts by itself at the first `recent` day and widens as Python widens it.
- **"Faded" = the band, not the lines.** The §9b rule holds: lines keep full colour, width and dash after the block. Measured on band over region: light ATL 4.1:1, TSB 3.5:1, CTL > 10:1; dark ATL 3.3:1, TSB 3.4:1, CTL 7:1 (all ≥ 3:1). The band is supplementary: the range is carried by the tooltip (§10c) and the sr text (§10d).
- **Boundary plan → recent:** no extra rule or strip label. At 390px the block end is ~70px right of "i dag", and `Prognose · anslået` (~125px) already occupies that space; a third label would collide or add a strip line and break the fold. The band's start is the boundary; the tooltip status names it.
- **Disclosure:** 5th term after `Prognose (anslået)`. Swatch: 24×12 `--prognose-band` over `--track` 60%, 1px `--chart-mark` ring. Term `Spænd efter blokken`, text: `Hvor fitness kan lande efter blokken, alt efter om dine styrkeuger bliver som den letteste eller den hårdeste af de seneste 4 hele uger. Jo længere frem, jo bredere.`
- No motion (Area animation off; the chart never animates).

### 10b. Flat or unknown band (the live case today)
- `low = high` (rounded to whole TSS) on a row: nothing visible is drawn there (zero-height fill), and the tooltip omits the range.
- **Strength unknown after the block** (any `basis.strength` entry with `method = 'recent'` and reason `no recent weeks to average`): note under the plot, 8px, `text-14` `--text-muted`, `max-width: 60ch`, same slot as the §9e note: `Styrke efter blokken (fra 26. okt.) er ikke med i prognosen endnu, fordi der ikke er nogen hele uger at regne et gennemsnit af. Den kommer med, når ugerne er gået.` The date is the first projection date with `strength_method = 'recent'`, format as the x ticks. The note sits below the x labels, so the §9f.1 fold is unaffected.

### 10c. Tooltip on a prognose day (replaces §9c's strength rows; other §9c lines unchanged)
| Line | Danish (exact; values tabular, U+2212) |
|---|---|
| Status, `strength_method = 'recent'` | `Prognose · efter blokken` (+ ` · dag anslået` per §9c). `plan` or null: §9c as is |
| Values, range present and low ≠ high | `Fitness (CTL) ≈ 46 (44 til 49)` · `Træthed (ATL) ≈ 44 (41 til 47)` · `Form (TSB) ≈ −2 (−6 til +3)`. No range otherwise |
| Strength, plan | `Styrke ≈ 45 TSS · session 2 · fra trænerens plan` (+ ` · dag anslået`) (+ ` · 2 sæt uden kg ikke talt med` when `unscored` > 0; 1: `1 sæt uden kg …`) |
| Strength, recent | `Styrke ≈ 40 TSS (30 til 52) · session 2 · gennemsnit af de seneste 4 uger` (`recent_weeks` = 1: `… af den seneste uge`; range omitted when low = high) (+ ` · dag anslået`) |
| `tss` null, `no day left this week` | `Styrke · session 2 · ikke talt med (ingen dag tilbage i ugen)` |
| `tss` null, `no recent weeks to average` | `Styrke · session 2 · ikke talt med (endnu ingen hele uger at regne gennemsnit af)` |
| `tss` null, `no kg for any set in the plan` | `Styrke · session 2 · ikke talt med (ingen kg i trænerens plan)` |
| `tss` null, unknown or missing reason | `Styrke · session 2 · ikke talt med` (never a guessed reason; "ikke lavet før" is retired) |

Lines wrap inside the tooltip (`max-w-72`); never truncated, also at 200% text.

### 10d. Screen-reader text (replaces §9d's prognose sentence)
- `Prognose, anslået ud fra trænerens plan og dine seneste uger: den ons. 25. nov. cirka fitness 48 (mellem 44 og 52), træthed 40, form plus 8.` The parenthesis uses the last row's `ctl_low/ctl_high` and is omitted when they are null or equal.
- In the §10b case, add: `Styrke efter blokken er ikke med i prognosen endnu.`

### 10e. States
| State | Treatment |
|---|---|
| `DEV_FIXTURE=empty` / `error` | §5 page states. No projection, no band, no note. |
| `DEV_FIXTURE=stale` / real stale | Band drawn from the rows as stored; nothing re-anchored. §9e region rule applies. |
| No band rows (all low/high null: block covers the window, or rows from before task 1a) | No band, no ranges, no §10b note. Disclosure term stays (static text). |
| Flat band, strength unknown (live today) | §10b: nothing drawn, note under the plot, tooltip reason per §10c. |
| Flat band, real zero spread | Nothing drawn, no range, no note. |
| `DEV_FIXTURE=band` (new, dev only) | Real rows; each `recent` projection row gets an illustrative spread (low < value < high, growing with distance) and its sessions a `recent` entry with `tss_low/tss_high`, `recent_weeks = 4`. Exists only so the band can be screenshotted before 4 real weeks have completed. Ignored in production like the other switches. |
| Loading / projection read fails | §9e unchanged. |
| Dark | Token dark value; contrasts per §10a. |
| Reduced motion | Nothing animates (as §9b). |

### 10f. Acceptance criteria (for `tester`)
1. `DEV_TODAY=2026-10-01` on live data: no band is visible, the §10b note appears under the x labels with the first `recent` date, and the tooltip on a session day after the block reads `… ikke talt med (endnu ingen hele uger at regne gennemsnit af)`. The string `ikke lavet før` exists nowhere in `web/src`.
2. `DEV_FIXTURE=band`, 390 × 844 and 1280, light and dark: a `--prognose-band` fill spans exactly `ctl_low`…`ctl_high` and only on rows where both are non-null; no band on ATL or TSB; all lines keep Part B colour, width, dash and full opacity; no new strip label; §9f.1 fold still holds.
3. A `node --test` test feeds rows with known `*_low/*_high` to the chart's data mapping and asserts the plotted band equals them unchanged (no UI arithmetic), and that null or equal low/high yields no band and no tooltip range.
4. Tooltips follow §10c verbatim for: a plan day (incl. `unscored` > 0), a recent day with a range (incl. negative TSB with U+2212 and `til`), `recent_weeks = 1`, each of the three reasons, and an unknown reason.
5. The open disclosure shows the rewritten `Prognose (anslået)` text and the `Spænd efter blokken` term verbatim; the sr text matches §10d (range in "mellem … og …", and the extra sentence in the §10b case).
6. At 200% text the tooltip lines and the §10b note wrap without clipping or overlap, in light and dark; nothing animates under `prefers-reduced-motion: reduce`.
