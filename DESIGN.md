# Design system – training-app

Contract between `design-lead` (owns this file) and `ui` (builds). Read before any UI work.

- **Part A: Guardrails.** Fixed. Never traded away, whatever the direction.
- **Part B: Direction.** The product's visual identity: **Spurt**, with Logbog's zone bar and a dark theme derived from Ro (chosen 2026-09-30). Token values live in `web/src/app/globals.css` and come from Part B.

When Part B and a pattern pack conflict, Part B wins on look and the pack wins on structure. Part A beats both.

---

## Product profile
- **Product type:** personal training companion. Three screens: **Træning** (today's session, with its full-screen **Fokus** mode for one set at a time), **Belastning** (fitness, fatigue and form over time) and **Analyse** (am I getting fitter: Cykel and Styrke now, Samlet later).
- **Primary users & context:** one user. On the phone in the gym between sets — a quick glance at arm's length, one hand, sweaty fingers — and at home; at the desk to review load.
- **Platform:** mobile web (home-screen bookmark), desktop browser for review. Next.js on Vercel.
- **Locale:** da-DK. Danish UI copy ("Træning", "Belastning", "7 af 24 sæt udført"). Dates `ons. 30. sep.`, times `kl. 09.31`, decimal comma. Exercise names and sheet cells are shown **exactly as written** in the coach's sheet (often English: "Lat pulldowns", "Bicep of choice").
- **References the user likes:**
  - **Whoop** — dark, calm, one big number per state, colour means status.
  - **intervals.icu** — dense and honest data, serious about the numbers.
  - **Strava** — energetic, clear cards, confident typography.
- **Pattern packs:** [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md) for `/load` (Belastning). `/` (Træning) and `/fokus` (Fokus) are workout screens, not dashboards.

---

# Part A – Guardrails (fixed)

## Principles
1. One screen answers one question. If the user needs to scroll to find the answer, the layout is wrong.
2. Mobile first. Design at 390px, then let it grow. Never the other way round.
3. Show state honestly: loading, empty, error and stale each have their own visible treatment. Never a blank area.
4. Numbers before decoration. On `/load` the key figure is the largest element; on `/` the session's prescription numbers are; on `/fokus` the current set's reps and kg. Charts support, never replace.
5. One primary action per screen, visually dominant. On `/` that is Begynd / Fortsæt træning; on `/fokus` one per view state (Udført, Til næste sæt, Tilbage til Træning).

## Tokens contract
Token **names and roles** are fixed here; their **values** come from Part B.
- Colour roles: `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--positive`, `--warning`, `--negative`, `--focus`, plus chart roles `--series-ctl`, `--series-atl`, `--series-tsb`, `--block-fill`, `--chart-mark`, the five form-zone roles `--zone-risk`, `--zone-optimal`, `--zone-grey`, `--zone-fresh`, `--zone-transition`, and Part B's `--track`, `--slab`, `--on-slab`, `--on-slab-muted`, `--slab-mark`, `--shadow-card`. (`--focus` and the zone roles replace the placeholder's accent-as-focus and the per-zone tones in `dashboard-view.ts`.)
- Every theme the direction ships (light, dark, or one only) meets the accessibility rules below.
- Spacing: 4-point scale – 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: one value per role (control, card, pill), no exceptions.
- Type: one scale, named by px (`text-12 … text-56`, set by Part B). Tabular numerals for every number that is compared or read mid-set. Glance sizes for `/` and `/fokus` are in "Træning" below.
- Semantic colours carry meaning only with a label, icon or shape – never colour alone.
- Tokens only: no magic values in components. Tailwind's default colour, text-size and radius scales stay removed.

## Layout: phone and desktop (decided 2026-10-13)
Two usage modes, two layouts. **Phone** (390px): in the gym and on the bike; Træning and Fokus live here. **Desktop** (1280px+): at the desk; Belastning and Analyse become real desktop screens, not a stretched phone.

**Breakpoints** (Tailwind's own, no custom ones):
- **Phone layout below `lg` (1024px)**, including tablets: one column, mobile first. `sm` (640px) only switches chart details (`--chart-height` 240, more x ticks).
- **Desktop = `lg` (≥ 1024px).** Every desktop rule below is an `lg:` class. Review widths: 390 and 1280.

**Frame.** One centred container for every screen and the nav, never full-bleed:
- Below `lg`: `max-w-content` (720px) with 12px gutters (`px-3`), as before.
- From `lg`: `--container-wide` = 79rem (1264px) with 32px gutters (`lg:px-8`), so content is **max 1200px**, centred. At 1280 the content box starts 40px from the window edge.
- Safe areas: the viewport is `viewport-fit=cover`. Gutters are `max(12px, env(safe-area-inset-left/right))`; the top padding is `max(12px, env(safe-area-inset-top))`.

**Two kinds of screen:**
| | Below `lg` | From `lg` |
|---|---|---|
| **Phone-first:** Træning `/`, Fokus `/fokus` | one column, full frame width | the same single column, `max-w-phone` (35rem = 560px). **Træning is left-aligned** (it shares the left edge with the top bar and every other screen's h1). **Fokus is centred** (no nav, a focus mode with no edge to hang from). Nothing reflows, nothing gets bigger. |
| **Desktop:** Belastning `/load`, Analyse `/analyse`, `/analyse/styrke` | one column, phone order | **header row + 12-column grid**: header row (h1, tabs, updated line, notices) spans the full 1200px; under it a grid `lg:grid-cols-12 lg:gap-6 lg:items-start`, columns 78px, gutter 24px. **Rail** = columns 1–4 (384px). **Main** = columns 5–12 (792px). |

**The desktop rule in one line:** the key figure sits top-left in the rail; charts sit in the main column; secondary lists sit in the rail under the key figure. DOM order is always the phone order (key figure → chart → list), so reading and tab order don't change with the width; grid placement does the rest.
- **Belastning:** rail row 1 = hero (zone bar, zone reading, fitness delta, CTL/ATL line); main rows 1–2 = chart card (`lg:col-start-5 lg:col-span-8 lg:row-start-1 lg:row-span-2`); rail row 2 = week card (`lg:col-start-1 lg:col-span-4 lg:row-start-2`). Chart and week card sit side by side; the chart gets 792px. Spec `design/specs/load.md` §11.
- **Analyse:** the section tabs stay (decided 2026-10-13, see `design/specs/analyse.md` §11): rail = the section's hero (Cykel: eFTP figure; Styrke: lift board), `lg:sticky lg:top-6`; main = the section's cards stacked, all the same width so the shared time axis and the `Ingen ture` seams stay aligned across charts.
- **Chart height:** `--chart-height` is 224px below 640, 240px from 640, **320px from `lg`**. Small multiples with their own fixed heights (Analyse's weekly strips, Styrke's lift panels) keep them.
- **Tables from `lg`:** a list that is a table in disguise becomes a real `<table>` in the main column (Cykel's excluded rides: Dato · Årsag · Forklaring · Fakta). Below `lg` it stays the stacked list.
- **States on desktop:** skeletons use the same grid classes as the page (no jump when data arrives). `ErrorState` and `EmptyState` replace the whole grid, span the full width under the header row, text capped at 60ch.

**Navigation (`ScreenNav`):**
- **Phone (below `lg`): bottom bar.** `fixed inset-x-0 bottom-0`, full window width, `--bg` with a 1px `--border` top hairline (decorative). Inside, the frame's gutters and the same `--track` pill with three equal tabs (44px high). Padding 8px top, `max(8px, env(safe-area-inset-bottom))` bottom. Bar height `--bottom-bar` = `calc(4.25rem + env(safe-area-inset-bottom))` (68px + inset). `main` gets `padding-bottom: calc(var(--bottom-bar) + 48px)` and `html` gets `scroll-padding-bottom: var(--bottom-bar)` so a focused element is never hidden under the bar (WCAG 2.4.11).
- **Large text:** when the tabs would wrap (the existing `@max-[20.5rem]` container query on the nav), the bar is **not fixed**: it falls back to the static strip at the top of the page (today's look), so it never covers a third of the screen at 200% text.
- **Desktop (`lg`): top bar.** Static (not sticky), in the frame, 16px from the top; the pill is auto-width and left-aligned (tabs `min-w-32`, `px-5`), 24px above the h1.
- **Fokus has no nav** at any width (unchanged).
- **Current tab** (every width): `aria-current="page"`, `--text` fill, `--bg` text, weight 700; the others 600 `--text` on `--track`. Fill + weight, never colour alone, never `--slab`. `/analyse/styrke` marks Analyse.
- DOM: one `<header><nav aria-label="Hovedmenu">` before `<main>` on every width, so keyboard users meet the nav first; only its position changes.

**Spacing and type on desktop:** the type scale is the same at every width (no desktop sizes; `text-56` stays the largest element). From `lg`: `main` stack gap 24px; card padding 24px on all sides; header row → grid 24px; prose capped at 60ch. Everything stays on the 4-point scale.

- Hero block at the top of `/load`: key figure + one-line status (top-left in the rail on desktop).
- Sticky elements: the phone bottom bar (fixed) and the Analyse rail (desktop). No sticky header.

## Components (minimum set)
- `KeyFigure` – label, value, delta (with direction), status colour.
- `Card` – title, optional action, content slot.
- `TrendChart` – one series or a few, responsive, axis labels readable at 390px, marker + readout row on touch, tooltip on hover ("Charts: interaction"), empty state built in.
- `StatusBadge` – text + semantic colour.
- `EmptyState` – icon, one sentence, optional action.
- `ErrorState` – what failed, when, retry.
- `ScreenNav` – tab strip (three links: Træning · Belastning · Analyse; absent on `/fokus`) in the root layout: bottom bar on phone, top bar on desktop ("Layout: phone and desktop"); current tab = `aria-current="page"`, marked by weight **and** a bar or fill, never colour alone.

## Interaction
- Touch targets ≥ 44×44px. Tap, not hover, for anything essential.
- Feedback < 100ms. Progress shown for anything > 1s.
- Keyboard: every interactive element focusable, visible focus ring, logical tab order.
- Loading: skeleton in the exact shape of the content, never a spinner in a card.
- Data freshness: show "updated <time>" wherever data comes from a job; mark stale (> expected interval) in `--warning` with text and an icon.
- Undo over confirm: tapping a done set again reopens it; Fokus has Fortryd for the latest tap; Afslut needs no confirm (progress is kept).

## Charts: interaction (every chart, decided 2026-10-13)
Applies to Belastning's trend, Cykel's eFTP, EF and weekly strips, and Styrke's e1RM panels and tonnage strips. It replaces each spec's tooltip.
- **Marker.** Selecting a day, ride or week draws a 1px `--text` vertical rule the full height of the card's plot stack. On a point chart it snaps to the nearest point and that point gets a 2px `--surface` ring. On week strips it sits at the slot centre. It is drawn in `--text`, not `--slab` (slab means "you are here").
- **Touch and pen** (`pointerType` ≠ `mouse`): there is **no floating tooltip**. Tap or drag moves the marker, and the values show in the **readout row**. The plot has `touch-action: pan-y`, so a vertical drag still scrolls the page and a horizontal drag scrubs. A tap outside the card's plot clears the selection (a document `pointerdown` outside it), and so does Esc.
- **Readout row.** It sits directly under the x labels, 8px down, inside the card and above the notes, at every width. It reserves a **fixed height**: the chart's line count × the `text-14` line height, as `min-height` in rem, so nothing jumps between days. At 200% text it may grow, because reflow beats no-jump. It is `aria-live="polite"` and is updated at most once per 150ms while dragging.
  - Line 1 is `text-14` 600 `--text`: the date or week, then ` · ` and a status when one applies.
  - Line 2 holds the value cells, `text-16` 600 tabular. Each cell is the series' legend swatch, then its label in `--text-muted`, then the value. The cells are 16px apart and wrap.
  - Further lines are `text-14` `--text-muted` facts.
  - **The line-series legend items move into the cells**, because a swatch next to a value is the legend. Only items that have no value stay in the legend above the plot: block, deload, excluded, prognose and slab.
- **Readout at rest** (nothing selected): it shows the **latest** day, ride or week in the same layout, with line 1 starting `Seneste · ` and no marker drawn. It is never blank. If there is no latest value, it shows `Tryk på grafen for at se en dag` (Belastning) or `… en uge` (week strips) in `--text-muted`.
- **Pointer** (`pointerType = mouse`): the marker follows the hover, and a floating tooltip (`rounded-control`, `max-w-72`, `pointer-events: none`) shows the same lines as the readout. It is **top-aligned 8px under the plot top and sits 12px to the right of the marker. It flips to the left of the marker when it would cross the plot's right edge**, so it never covers the marker or the hovered point. It hides on `pointerleave`. The readout row stays at rest, so the values never appear twice.
- **Keyboard: keep what exists.** The chart is one focusable group. ←/→ steps a day, ride or week (Recharts' `accessibilityLayer` on `/load`, `WeekStrips` on Analyse), and Esc clears. A keyboard selection uses the **readout row**, not the floating box. The focus ring sits on the card's plot.
- **Prognose days:** line 1 reads `tors. 8. okt. · Prognose` (` · efter blokken` and ` · dag anslået` as `load.md` §10c), every value has `≈ `, and ranges go to a facts line. Measured days never show `≈`.
- **Gaps:** a gap is never read as 0. On a point chart, if the marker would snap to a point more than 14 days from the tap and the tap lies inside an `Ingen ture` seam, it stays at the tap and line 1 reads the seam: `Ingen ture · 30. sep. 2025 – 10. mar. 2026`. A week with no rides reads `Ingen ture`, and a week between blocks reads `mellem blokke`. A missing value is `–`, spoken `ikke registreret`.
- **Readout per chart** (copy and number formats as each spec: decimal comma, U+2212, W whole, EF 2 dp, hours `h:mm t`):

| Chart | Lines | Line 1 | Cells (line 2) | Facts (line 3+) |
|---|---|---|---|---|
| Belastning trend (`load.md`) | 3 | `ons. 30. sep.` (+ ` · Prognose …`) | `Fitness 45` · `Træthed 41` · `Form +4` | `Program - blok 12 (offseason)` (+ ` · deload`); prognose: the `Cykel ≈ …` / `Styrke ≈ …` basis lines and the range `Spænd: fitness 44 til 49` |
| eFTP pr. tur | 3 | `tirs. 3. jun. 2025 · Udendørs tur` (`Virtuel tur`) | `eFTP 212 W` · `NP 182 W` · `VI 1,08` | `1:45 t · 48,2 km`. Excluded: line 1 `… · Udeladt: For kort`, facts as `analyse.md` §5e |
| VI cell | | | Flagged: value `--warning` + `WarningLine` triangle, sr `, ujævn effekt på en Z2-dag`. No VI: `VI –` (the cell is kept, so nothing shifts) | |
| EF (rolige ture) | 3 | `tirs. 3. jun. 2025` | `EF 1,24` · `Trend 1,22` (`Trend –` when null) | `NP 165 W · puls 133 · 1:45 t` |
| Timer og belastning | 3 | `Uge 23 · 2.–8. jun. 2025` (+ ` · indtil videre`) | `Timer 4:30 t` · `Belastning 210 TSS` · `Ture 3` | `1 udeladt fra trends`; zero week: line 2 `Ingen ture`; null load: `Belastning –` + fact `Belastning ikke beregnet` |
| Styrke e1RM | 4 | `Uge 39 · 22.–28. sep. · blok 12, uge 1` (+ suffixes per `analyse-styrke.md` §5c) | none: one line per lift, `Squat 174,1 kg · 140 kg × 5 · RPE 6,5 foreskrevet` (` · bedst i blokken`) | the lift lines are lines 2–4 |
| Styrke tonnage | 4 | as e1RM | none: one line per lift, `Squat 2.100 kg · 12 sæt` / `Squat ikke trænet` | lines 2–4 |

## Accessibility checklist (run before merge)
- [ ] WCAG 2.2 AA in every theme: text ≥ 4.5:1; large text, icons, check rings and control borders ≥ 3:1.
- [ ] Colour never carries meaning alone (zones have a label, ticks have a ✓ shape, the current tab has weight + bar).
- [ ] Semantic HTML (`main`, `header`, `nav`, headings in order, `button` vs `a`).
- [ ] Charts have a text alternative (a table or a sentence with the key values).
- [ ] Icon-only buttons have `aria-label`.
- [ ] Text scales to 200% without horizontal scroll.
- [ ] `prefers-reduced-motion` respected; every motion has a still alternative.

## Technical
- Fonts are self-hosted with `next/font` (never fetched from a third party at runtime), max 2 families: Barlow + Barlow Condensed (Part B).
- UI library: none yet. If Part B adopts shadcn/ui, it is themed entirely from these tokens. **Never the library's default look.**

## Don'ts
- No dashboards with 8 widgets. Max 3 things above the fold on `/load`.
- No icon-only buttons without `aria-label`.
- No charts without units.
- No decoration that serves neither the direction nor the hierarchy.

## Project rules
- **Screens:** three routes linked by `ScreenNav` ("Træning" · "Belastning" · "Analyse"), plus `/fokus` without nav. All UI copy is Danish; the exact strings live in `design/specs/traening.md` §6, `design/specs/load.md` §4 and §6, `design/specs/analyse.md` §6 and `design/specs/analyse-styrke.md` §4–6.
  - `/` **Træning** answers "What is my session, and how fresh am I for it?" and `/fokus` **Fokus** answers "What do I lift now?" (spec `design/specs/traening.md`, rules in "Træning" below).
  - `/load` **Training load / Belastning** answers "How loaded am I right now, and is fitness going up?". The bullets below, from "Key figure" to "Data", describe `/load`.
  - `/analyse` **Analyse** answers "Am I getting fitter?" in two sections, which are link tabs (`Cykel` · `Styrke`, `aria-current`, no tab roles, no Samlet placeholder) under the shared h1:
    - `/analyse` **Cykel** ("on the bike?", spec `design/specs/analyse.md`): the hero is the eFTP figure, and `--slab` marks the latest eFTP point and the current week.
    - `/analyse/styrke` **Styrke** ("in the three main lifts?", spec `design/specs/analyse-styrke.md`): the hero is the lift board, the block-best e1RM per lift. `--slab` marks only the current week's tonnage bars. e1RM provenance is ink for logged RPE and faded for prescribed RPE, and is always named in words. The sheet's 1RM is labelled `1RM i arket (ikke testet)` and is a reference only.
    - Both follow the data-dashboard pack. Each section shows its own `UpdatedLine` under the tabs.
- **Pattern packs:**
  - `/load` follows [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md). Conflict: the pack rounds kg to 1 decimal, but this app shows kg as logged (up to 2 decimals), because the user compares against their own sheet. DESIGN.md wins.
  - `/` Træning and `/fokus` are not dashboards, so the pack's "key figure is the largest element" does not apply there: the session's prescription numbers (Fokus: reps and kg) are. Its data-honesty rules do apply: freshness, gaps never shown as zeros, whole watts.
- **Key figure (hero):** TSB today (form = CTL − ATL) from the latest `daily_load` row, shown as the zone bar (Part B, hero size), with a one-line status.
- **Chart:** CTL, ATL and TSB per day since 2026-01-01. Strength blocks shaded (`blocks.start_date` → `end_date`, an ongoing block runs to today); deload weeks marked (`blocks.deload_start` → `end_date`) by pattern, not only colour.
- **Secondary:** this week's sessions (ISO week, Mon–Sun) — cycling TSS and strength TSS per day, plus the week total from `weekly_load`. A week switcher (`?week=2026-W33`, previous / next ISO week, "Back to this week") looks back; days expand to their rides and strength exercises.
- **Freshness:** "updated <time>" from the latest `daily_load` row; stale when older than 26 h (the job runs daily ≈ 05:00 Europe/Copenhagen).
- **Units:** load in TSS; CTL / ATL / TSB in TSS/day.
- **Form zones** (intervals.icu bands, Python computes them): ≤ −30 high risk · −30..−10 optimal · −10..5 grey zone · 5..20 fresh · ≥ 20 transition. Always shown with their label.
- **Data:** read-only, server-side, from `daily_load`, `blocks` and `weekly_load`. The UI never calculates training metrics (Python owns them).

### Week card (added by `ui`, M2 week detail; Danish copy in `design/specs/load.md` §6)
- Title "Denne uge · uge N" for the latest week, "Uge N" otherwise; the "Tilbage til denne uge" link sits in the card action.
- Switcher: previous / next are real links (44 × 44, `aria-label` names the target week), absent at the ends (an empty 44px box keeps the label centred). They use `scroll={false}` so switching keeps the scroll position and keyboard focus. Label: date range + ISO week (`2026-W33`).
- Switching weeks re-renders only the day list: a `<Suspense>` keyed by the week shows its skeleton; hero and chart never flash. Detail errors show an ErrorState inside the card.
- Days are a list of rows, not a table: native `<details>/<summary>` (keyboard and screen reader without JS), a 16px chevron that rotates without transition. Rest days (no ride and no strength activity) are a plain row reading "Hvile". Strength sits on its matched activity's date; planned-but-undone sessions are not shown (spec `design/specs/traening.md` §8). Column heads are visual only; each row speaks "cykling N TSS, …".
- Row grid: day + three 64px TSS columns when the list is ≥ 20rem wide (Tailwind `@xs` container query, so it tracks text size); narrower, e.g. at 200% text, the day moves above the numbers instead of scrolling sideways.
- Missing values show "–", spoken as "ikke registreret". A blank kg on a weighted exercise reads "intet kg logget", never "0 kg". Score/set is labelled as the raw score before the strength factor.
- Power data badge (added 2026-10-13): under a ride's name, "Tjek effektdata" in `text-14` 600 `--warning` with the `WarningLine` triangle (never colour alone), a native `<details>` summary (44px target): tapping it shows Python's message (which rule fired) in `--text-muted`, since a tooltip doesn't show on a phone; `title` gives the same text on hover. A 16px chevron after the label (the day rows' chevron, `aria-hidden`, rotates without transition when open) shows that it opens; the opened text sits 4px under it, max 60ch. /load shows each `app_notices` row (e.g. "FTP er sat til 230 W, men dine ture peger på 183 W") as a `WarningLine` under the "Opdateret" line: data-quality status belongs with freshness, above the hero and smaller than it. The FTP notice ends with why and what next (review 2026-10-13), keyed by the notice kind, as a second sentence in the same line: "Cykel-TSS regnes ud fra FTP, så ret den i intervals.icu." (true in both directions, so it never guesses whether TSS is too high or too low).
- VI (added 2026-10-12): after NP and IF on a ride, "VI 1,18" (Python's ride_metrics.vi, 2 decimals). The term "VI" is an `<abbr>` with the tooltip "Jævnhed – 1.0 = konstant effekt" (supplementary: hover only, so nothing essential depends on it). When Python flags it (VI > 1.15 on a Z2 day: a planned session or the ride named "Z2"), the value is `--warning` with the triangle from `WarningLine` and sr-only ", ujævn effekt på en Z2-dag": never colour alone. A ride without VI (no NP or no average power) shows no VI item.
- Effective kg (added 2026-10-12): on a bodyweight exercise whose effective kg (Python: logged + BODYWEIGHT × the exercise's bodyweight fraction) differs from the logged kg, the load line adds "· 95 kg effektivt" in `--text-muted`, spoken ", effektivt 95 kg". The logged kg stays as written; nothing is shown where the two are the same.

### Træning (`/`) and Fokus (`/fokus`) (design-lead; renamed from Today 2026-10-12; full spec `design/specs/traening.md`)
- **Use:** a companion for the gym and the handlebar, read at arm's length (≈ 60–80 cm). `/` **Træning** is the overview of the day: the form flag with a one-line hint, the open strength session with its one primary action (**Begynd træning** / **Fortsæt træning**), ride and rest cards. `/fokus` **Fokus** is a full-screen mode for one set at a time, reached from that button; it is not a nav tab.
- **Data:** server-side, read-only except the **set log** (below). Træning uses the latest `daily_load` row for the form flag, the next undone strength session of the ISO week (session k + 1 of N; the n-th strength activity of the week is session n, and undone sessions have no date), and `planned_sessions` for rides. Python computes every number, including target watts and the suggested kg; the web only formats. The rest timer (now − last done tap) is a clock, not a training metric. The date is the Europe/Copenhagen date at request time.
- **Glance sizes** (Part B scale):
  - Fokus: `text-56` for reps (Condensed 700 upright) and the kg figure (Condensed 800 italic for a suggestion, 700 upright for last week's logged kg); the rest timer `text-56` italic. These are the largest things on the screen.
  - Træning: `text-32` Barlow Condensed 700 tabular for anything read mid-set or mid-interval (reps, prescription, target watts); `text-20` for exercise names, set lines, the Forslag / Sidste uge line, step labels and durations; `text-16` / 14 muted for supporting lines. Nothing in a session card is smaller than 14px.
- **As written vs computed:** sheet strings (name, reps, prescription) are shown verbatim ("8 - 12", "RPE 6 - 7", "-12.5%"); only screen-reader text rewrites " - " to " til ". Python numbers use the shared formatters. In Condensed figures, **upright = as written in the sheet, italic = computed by the app** (the suggestion, the zone-flag value). The suggested kg always carries the word `Forslag` and never sits in the prescription line, so it can never pass for a prescribed or logged value. The sheet's own pre-filled kg is not shown on Træning or Fokus (decided 2026-10-12).
- **Set groups and tick lines (Træning):**
  - One group per sheet row: name (first group of a run, and the NÆSTE group), prescription line, Forslag / Sidste uge line, then one tick line per set.
  - Each set is a `<label>` wrapping a native checkbox, ≥ 44px, the whole line is the target: check, `Sæt 1 af 2`, and a right-aligned status (`kl. 18.42`, `sprunget over`, or the Næste tag). Its accessible name is the full sentence (`Squat, sæt 1 af 2, 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg`).
  - Check: 28px circle. Open = `--text-muted` ring; done = `--slab` fill with a `--slab-mark` ✓; skipped = ring with a minus bar plus the word. Shape carries meaning, not colour. Done/skipped text turns muted; no strike-through, no reordering, lines never move.
  - Tapping an open or skipped set marks it done; tapping a done set reopens it (undo). The focus ring surrounds the whole line.
  - Dividers go between runs only; the slab hides the dividers it touches.
- **Set state (replaces the in-memory tick rule, 2026-10-12):**
  - Every set's state (open / done with `ended_at` / skipped) lives in the set log and is read back on every load, so ticks and Fokus survive reloads, devices and retries.
  - Ticks and Fokus taps are optimistic: the UI changes within 100ms and never waits for the save. All writes go through the one server action; kg is never written (it is logged in the sheet).
  - A failed save keeps the tick on screen and shows a `WarningLine` with the count of unsaved sets and a **Gem igen** button that resends them in order: "1 sæt er ikke gemt. De står her, men forsvinder, hvis siden genindlæses." Under DEV_TODAY / DEV_FIXTURE nothing is written and a muted line says "Testvisning: sæt gemmes ikke."
  - Footnote: "Forslag er et skøn ud fra din e1RM og RPE, ikke trænerens tal. Hvert sæt gemmes, når du sætter flueben; kg logger du i arket."
- **Fokus rules:**
  - No ScreenNav. The top bar is fixed in layout: **Afslut** (link to `/`, no write, no confirm: progress is kept), the count "7 af 24 sæt udført", the segmented progress by position, and a reserved 44px last-tap row with **Fortryd** (undoes the latest done/skip; repeatable).
  - Three view states, one primary action each, so Part A's "one primary action per screen" holds per state and needs no override: **set view** (the current set on a full `--slab` card, **Udført** inside it in `--slab-mark`; **Spring over** secondary below), **rest view** (`--surface` card with "Pause" and a count-up timer, the next set in a small slab, **Til næste sæt**: UI only, no write), **finished view** (slab card, counts, times, "Husk at logge kg i arket.", **Tilbage til Træning**).
  - Reload rebuilds the view from the log: current set = first open set; rest view if the latest tap was a done tap.
  - A screen wake lock is requested while Fokus is visible (enhancement; nothing shown if unsupported).
  - Focus moves to the next view's primary button; one polite status region announces each set change once; the timer is never announced on its own. Inside a slab the focus outline is `--slab-mark`.
- **Ride steps:**
  - Left column: label and duration.
  - Right column: watts in text-32, unit included ("238 W": a smaller capital W reads as "w"), % FTP below it in muted text.
  - Repeat groups get a "Gentag N gange" header, with their steps indented 16px behind a 2px `--chart-mark` rule.
- **Order (Træning):** page header (title, updated line, form flag + hint, session block with the primary button), then ride card(s), the strength card, and the rest card (only when no ride today and no strength session left this week). The session block sits above the ride card so the primary action is above the fold on every day. Rest wording never depends on strength dates.
- **Freshness:**
  - The same "updated" line as `/load`. The stale sentence names the consequence: "Form og styrkeprogrammet kan være forældet." Fokus shows staleness only when stale, as a `WarningLine`.
  - A failed plan read is an ErrorState, never a rest day.
- **Nav:** `ScreenNav` is a three-tab strip ("Træning" · "Belastning" · "Analyse") on every screen except `/fokus`: a fixed **bottom bar** on phone, a static top bar on desktop (Part A "Layout: phone and desktop", changed 2026-10-13 at the user's request; it was a static top strip). The bar replaces the top strip's 68px, so the session block moves up by the same amount; `traening.md` §3.5 keeps its button guarantee against the viewport minus `--bottom-bar`.

---

# Part B – Direction: Spurt (chosen 2026-09-30)

**Decision:** base **Spurt** (type, light palette, shape, density, motion, the NÆSTE slab, the segmented progress bar) + **Logbog's zone bar** as the one form element on both screens, restyled in Spurt's language + **dark theme derived from Ro's palette**. The Mode 0 samples (Ro, Logbog, Spurt) are local HTML files, git-ignored; this part is the contract, not the samples.

## Personality
**Energetic, bold, decisive.** Ink, warm grey and one volt accent; big condensed italic headings; prescriptions you can read at 70cm with sweaty hands. `/load` uses the same type and tokens but stays calm: no volt in the chart, card titles in text face.

**The one idea:** `--slab` means **"you are here"**. It fills the NÆSTE group, the zone flag and marker, ticked checks, done progress segments, Fokus's set card and finish card, and the rest view's next-set preview, and nothing else. In light it is ink, in dark it is volt.

## Colour tokens
Switched by `prefers-color-scheme` (no toggle). Contrast is measured against the backgrounds listed.

| Token | Light | Dark | Use and contrast |
|---|---|---|---|
| `--bg` | `#efeee9` | `#0b0e12` | page |
| `--surface` | `#ffffff` | `#141920` | cards. Dark cards are raised by tone only (Ro): no border, no shadow |
| `--border` | `#e4e2dc` | `#262d37` | dividers between runs, chart grid. Decorative only, never a control border |
| `--track` | `#d9d7d0` | `#2c3440` | nav track, empty progress segments, skeleton fill. Text on it: 13.0 / 11.1:1 |
| `--text` | `#121212` | `#eef1f5` | 16.1 (bg), 18.7 (surface) / 17.1, 15.6:1 |
| `--text-muted` | `#595959` | `#9ba6b4` | secondary text **and** the unticked check ring. 6.0, 7.0 / 7.8, 7.2:1 |
| `--accent` | `#d4ff3a` | `#d4ff3a` | volt. Light: **only on ink** (via `--slab-mark`); never text, line or icon on `--bg`/`--surface` (1.0–1.2:1). Dark: 16.7:1 on bg; used only via `--slab` and `--focus` |
| `--slab` | `#121212` | `#d4ff3a` | "you are here" fill: NÆSTE group, zone flag + marker, ticked check, done segments, Fokus set/finish card and next-set preview |
| `--on-slab` | `#ffffff` | `#121212` | text on slab: 18.7 / 16.2:1 |
| `--on-slab-muted` | `#bdbdbd` | `#3d4a0f` | secondary text on slab: 10.0 / 8.3:1 |
| `--slab-mark` | `#d4ff3a` | `#121212` | ✓ in a ticked check, the check ring on the NÆSTE group, the NÆSTE tag fill, the Udført button fill and the focus outline inside a slab: 16.2:1 against `--slab` |
| `--focus` | `#121212` | `#d4ff3a` | 3px outline, 3px offset: 16.1 / 15.3:1 on bg/surface |
| `--positive` / `--warning` / `--negative` | `#18743a` / `#8a4f00` / `#b42318` | `#4ade9a` / `#f5c451` / `#ff7b7b` | status text (stale line, errors), always with words or an icon. The `/load` fitness delta stays `--text` (neutral): a falling CTL in a deload week is planned, so red/green would judge what the data can't; the arrow + words carry direction. Light ≥ 5.0:1 on bg; dark ≥ 6.4:1 on bg, surface and block fill |
| `--series-ctl` | `#121212` solid 2.5px | `#eef1f5` solid 2.5px | fitness: the line the question is about, so it gets the ink |
| `--series-atl` | `#595959` dashed 2px (6 4) | `#9ba6b4` dashed 2px | fatigue. 6.0 / 6.5:1 on block fill |
| `--series-tsb` | `#1f5bd0` dotted 2px (round caps) | `#7aa7ff` dotted 2px | form, the chart's only hue. 5.2 / 6.7:1 on block fill |
| `--block-fill` | `#efeee9` | `#1c222b` | strength-block shading behind the lines |
| `--chart-mark` | `#807e78` | `#737d8a` | zero line, deload hatch, axis ticks: 3.5 / 3.8:1 on block fill |
| `--prognose-band` | `rgb(18 18 18 / .16)` | `rgb(238 241 245 / .18)` | CTL uncertainty band after the strength block (load.md §10a). Supplementary: the range is in tooltip and sr text. Lines on it stay ≥ 3.3:1 (ATL dark, the lowest) |
| `--zone-risk` | `#f0b9aa` | `#542f32` | band fills in the zone bar and the flag swatch. **Supplementary tints:** 1.2–2.1:1 against the page, so they never carry meaning alone. The zone name (text), the threshold numbers and the active band's 2px `--text` outline do. In dark they are Ro's zone colours (`#ff7b7b`, `#4ade9a`, `#a9b3c1`, `#5ab8ff`, `#f5c451`) at 30% over `--bg` |
| `--zone-optimal` | `#c3e0b0` | `#1e4c3b` | as above |
| `--zone-grey` | `#d3d0c8` | `#3a3f47` | as above |
| `--zone-fresh` | `#b9d4ec` | `#234159` | as above |
| `--zone-transition` | `#f0d9a0` | `#514525` | as above |
| `--shadow-card` | `0 1px 0 rgb(0 0 0 / .05), 0 12px 28px -18px rgb(0 0 0 / .35)` | `none` | light cards lift off the warm grey; dark uses tone |
| `--chart-height` | 224px below 640px, 240px from 640px, 320px from 1024px (`lg`) | same | keeps hero + chart above the fold at 390 × 844 (load.md §9a); 320 gives the desktop main column (792px) a readable 2.5 : 1 plot |

- **Links** (e.g. "Tilbage til denne uge"): `--text`, weight 600, underline 1px offset 3px. Volt is never a link colour.
- **Nav current tab:** `--text` fill with `--bg` text, weight 700 (fill + weight, not colour alone). It deliberately does not use `--slab`.
- **Section tabs** (`/analyse`, `AnalyseTabs`): the section word is the tab. `text-32` Condensed italic uppercase; current 800 `--text` + 4px `--text` bar under the word; other 700 `--text-muted`. Never ScreenNav's pill track (two pill strips read as one menu), never `--slab`.

## Type
**Decision (2026-09-30): Barlow + Barlow Condensed stay.** Chosen over Instrument Sans (one family with a width axis), Inter + Roboto Condensed, and Manrope + Sofia Sans Condensed. Those were rendered on Today at 390px, light and dark, against a brief for a calmer grotesk, and the user kept Barlow. Checked on the way: Barlow's default figures are proportional, but `tabular-nums` makes every digit the same width, so tabular figures work as specified below.

Two families, self-hosted with `next/font/google`, which downloads the files at build time and serves them from the app (no Google `<link>`, no runtime request to Google).

```ts
Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" })
Barlow_Condensed({ subsets: ["latin"], weight: ["700", "800"], style: ["normal", "italic"], variable: "--font-barlow-condensed", display: "swap" })
```
Tailwind `@theme inline`: `--font-sans: var(--font-barlow), system-ui, sans-serif` and `--font-display: var(--font-barlow-condensed), system-ui, sans-serif`. The `latin` subset covers æøå, × and the U+2212 minus. The ✓ is not a Barlow glyph: draw it as an inline SVG (2.5px stroke).

| Token | Size / line-height | Face | Use |
|---|---|---|---|
| `text-56` | 56 / 1.0 | Condensed 800 italic, tabular | the `/load` zone-flag value (the largest element on `/load`, Part A principle 4); Fokus's suggested kg and rest timer (computed = italic) |
| `text-56` | 56 / 1.0 | Condensed 700 upright, tabular | Fokus's reps and last week's logged kg (as written / logged = upright). With the row above, the largest things on `/fokus` |
| `text-44` | 44 / 1.0 | Condensed 800 italic, uppercase, −0.01em | page title: "TRÆNING", "BELASTNING"; Fokus's finish title "SESSION 2 ER KLARET". Date after it in `text-16` Barlow 500 `--text-muted`, sentence case |
| `text-32` | 32 / 1.1 | Condensed 700 upright, tabular | **prescriptions** on Træning: reps ("5 reps"), prescribed load ("RPE 7"), target watts ("238 W", W the same size); Fokus button labels (italic 800) |
| `text-32` | 32 / 1.0 | Condensed 800 italic, uppercase | session-card titles on `/` ("STYRKE", "CYKEL"). On `/load` card titles are `text-20` Barlow 700, sentence case (calm) |
| `text-24` | 24 / 1.0 | Condensed 800 italic, tabular | Træning's form-flag value; the done count in "**7** af 24 sæt udført"; the Begynd / Fortsæt button label |
| `text-20` | 20 / 1.4 | Barlow 700 | exercise names, "Session 2 af 3 i denne uge", step labels and durations, last-week reference (500) |
| `text-16` | 16 / 1.4 | Barlow 400 / 600 | body, block identity, nav tabs (600, current 700) |
| `text-14` | 14 / 1.4 | Barlow 400 / 700 | supporting lines, footnote; labels ("FORM (TSB)", zone names, NÆSTE) in 700 uppercase +0.04em (NÆSTE +0.08em), threshold numbers 600 tabular |
| `text-12` | 12 / 1.4 | Barlow 500, tabular | chart axis labels only. Never inside a session card (Part A: ≥ 14px there) |

Every compared or mid-set number uses `font-variant-numeric: tabular-nums`, including the zone-bar numbers. There is no third family and no monospace.

## Shape
| Radius token | Value | Used for |
|---|---|---|
| `rounded-card` | 24px | cards |
| `rounded-control` | 16px | tick rows (the focus outline follows it), the NÆSTE slab, chart tooltip |
| `rounded-pill` | 999px | nav track and tabs, zone flag, StatusBadge |
| `rounded-mark` | 4px | progress segments, zone bands, the NÆSTE tag, the flag swatch |

- Depth: light uses `--shadow-card` and no card border. Dark has no border and no shadow: `--surface` on `--bg` (Ro).
- Dividers: 1px `--border` between runs only. The slab hides the dividers it touches.
- Check: a 28px circle with a 2.5px ring (3px on the slab).

## Space and density
Balanced: big type, tight rows. All values are on the Part A 4-point scale.
- Page gutter 12px (content 366px at 390). Widths and the desktop grid: Part A "Layout: phone and desktop" (720px single column below `lg`; 1200px frame from `lg`; Træning/Fokus 560px).
- Header (phone): the title 12px from the top (the nav is the bottom bar); "Opdateret …" 4px under the title; the zone bar 12px under that. Desktop: top bar 16px from the top, the title 24px under it.
- `main` stack gap 16px (24px from `lg`), bottom padding 48px plus `--bottom-bar` on phone.
- Card padding 24px top, 16px sides and bottom (24px all round from `lg`). Inside a card: progress bar 12px under the head, done list 16px, session line 12px, list 12px.
- Tick row: min-height 44px, padding 8px 4px, grid `28px 1fr` with a 12px gap; the check aligns to the prescription line (bottom, 4px up).
- `/load` keeps its week-card layout (Part A) with these tokens.

## Motion
Snappy, short, and only on things you touched. Easing `ease-out`.
- **Press:** a check scales to 0.9 on `:active` and fills in 120ms.
- **Hand-over:** when the last open set of a group is ticked, the slab colour cross-fades off that group and onto the group of the next open set in 180ms. Colour only: lines never move or reorder.
- **Progress:** the touched segment fills in 120ms.
- **Fokus:** Udført, Til næste sæt and Spring over scale to 0.97 on `:active` (120ms); switching between set, rest and finished view cross-fades the card's opacity in 180ms. Nothing slides; the top bar never moves; timer digits, kg and reps never animate.
- **Never animated:** numbers, the zone marker (no slide on load or update), the chart, page transitions.
- **Reduced motion:** under `prefers-reduced-motion: reduce` every transition is 0ms and the press scale is off. The end state is the still alternative. Skeletons pulse only under `motion-safe`.

## Signature components

### NÆSTE slab (Træning, strength card; rule changed 2026-10-12)
- The **set group (sheet row) that holds the first open set** (document order; skipped sets are not open) becomes the slab. No slab when no set is open.
- It is filled `--slab` with `--on-slab` text. Prescriptions are also `--on-slab` (not muted); labels ("Forslag", "Sidste uge") are `--on-slab-muted`. Inside it, the open check ring is 3px `--slab-mark`, a done check is `--slab-mark` filled with a `--slab` ✓.
- It bleeds 8px past the group on both sides (margin-inline −8px, padding 12px), with 8px margin-block and `rounded-control`.
- The group's name line **always shows the exercise name**, even inside a run (override). The **NÆSTE** tag sits right-aligned on the **first open set's line**: `text-14` 700 uppercase +0.08em, `--slab-mark` fill, `--slab` text, padding 2px 8px, `rounded-mark`.
- The set's accessible name ends with ", næste", so screen readers hear it too.
- Focus: a 3px `--focus` outline with 3px offset around the set line.
- **In Fokus the slab grows into the whole set card** (the same "you are here", at full screen), with Udført inside it in the tag's colours (`--slab-mark` fill, `--slab` text).

### Segmented progress (Træning strength card head and Fokus top bar)
- The head reads "**2** af 8 udført": the count in `text-24` display, the rest in `text-16` 600.
- Under it, one segment **per set** of the session, **by position** (since 2026-10-12): done `--slab`, skipped `--track` with a 2px `--text-muted` centre bar, open `--track`. 8px high, 4px gaps (2px above 30 sets), `rounded-mark`.
- The first *k* segments are `--slab`, where *k* is the ticked count (not the ticked positions). The rest are `--track`.
- `aria-hidden`: the text carries the count.

### Zone bar (form: `/load` hero; its flag alone on Træning)
Replaces the TSB number + zone badge on both screens. It is one component (`ZoneBar`) in two sizes. On `/load` the chart gets **no zone banding** (see below).

**Scale.** −40 … +30 TSS/dag, linear: `x = (clamp(tsb, −40, 30) + 40) / 70`. Band thresholds −30 / −10 / 5 / 20 (intervals.icu):

| Band | Range | x span | Label |
|---|---|---|---|
| `--zone-risk` | < −30 | 0 – 14.29% | Høj risiko |
| `--zone-optimal` | −30 … −10 | 14.29 – 42.86% | Optimal |
| `--zone-grey` | −10 … 5 | 42.86 – 64.29% | Gråzone |
| `--zone-fresh` | 5 … 20 | 64.29 – 85.71% | Frisk |
| `--zone-transition` | > 20 | 85.71 – 100% | Overgang |

The thresholds are drawing constants for the scale only. They live in one frontend constant. **Which zone is active always comes from `daily_load.form_zone`** (Python), never from the UI comparing numbers.

**Anatomy, top to bottom:**
1. **Label line.** "FORM (TSB)" (`text-14` 700 uppercase) and "TSS/dag" (`text-14` `--text-muted`). 8px gap below.
2. **Flag.** A `rounded-pill` in `--slab` holding three things:
   - the signed value in display 800 italic tabular ("+4", "−12" with U+2212);
   - an 8px gap, then a 12px `rounded-mark` swatch in `--zone-<active>` with a 1.5px `--on-slab` ring;
   - a 6px gap, then the zone name in `text-14` 700 uppercase `--on-slab`.

   Position: `left: x%; transform: translateX(−x%)`. That keeps the pill inside the bar at both ends without measuring.
3. **Notch + marker.** An 8 × 6px `--slab` triangle under the flag, then a 3px `--slab` line through the band to 4px below it. Both sit exactly at `x`.
4. **Bands.** 12px high, `rounded-mark`. Each band is placed at its exact % span and inset 2px at inner edges, so there is a 4px gap centred on each threshold (echoing the progress bar) and the scale stays linear. The **active band** gets a 2px inset `--text` outline.
5. **Threshold numbers.** "−30", "−10", "5", "20" centred under the gaps, 4px below the bands, in `text-14` 600 tabular `--text-muted`.

**Sizes:**

| | Compact (Træning: **flag only**, prefixed "TSB", with the one-line hint) | Hero (`/load`) |
|---|---|---|
| Value | `text-24` | `text-56` |
| Pill padding | 4px 12px (32px high) | 4px 16px (64px high) |
| Below the bar | nothing | the existing fitness delta and "Fitness (CTL) … − træthed (ATL) …" detail line, 12px under the numbers |
| Height at 390px | ≈ 96px | ≈ 130px |

**Accessibility:**
- Flag text is real HTML text (it scales to 200%). Bands, notch and marker are `aria-hidden`.
- One `sr-only` sentence carries the whole reading, e.g. "Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5." It is written out, so screen readers never have to guess "−".
- Meaning is never colour alone: zone name in text, threshold numbers, and the active band's outline.

**States:**
- **Loading:** skeleton in the bar's shape: the label line, then 5 `--track` bands. No flag.
- **No TSB:** bands without marker or outline. In place of the flag, `text-16` `--text-muted`: "Form er ikke beregnet endnu."
- **TSB without zone:** the flag shows the value only. Under the numbers, `text-14` muted: "Zone ikke beregnet." No active outline.
- **Out of range (< −40 or > 30):** the marker is pinned to the bar end as an 8px outward chevron. The flag still shows the true value.
- **Stale:** the bar is unchanged. The "Opdateret" line carries staleness (Part A), so no data is greyed out.

**`/load` chart: no zone band shading.** CTL, ATL and TSB share one TSS/dag axis. Bands would put a CTL of 45 inside "Overgang" (dishonest), and the chart background already encodes strength blocks and deload hatch. Consistency comes from the identical `ZoneBar` directly above the chart and from the dotted `--series-tsb` line. If TSB ever gets its own panel, the bands may go behind that panel only.

## Technical
- Tokens are defined once in `web/src/app/globals.css`, exposed through `@theme inline` as `--color-*`, `--text-*` (12, 14, 16, 20, 24, 32, 44, 56), `--radius-card/control/pill/mark` and `--font-sans/--font-display`. Tailwind's default colour, text-size and radius scales stay removed. The placeholder values (system fonts, blue accent, 8/12 radii, `text-28`/`text-40`) are retired.
- **shadcn/ui: not adopted.** The app has no dialogs, menus, forms or popovers, just a checkbox row, tabs, a badge and cards, all native HTML plus Tailwind. It would pay off only if settings or logging ever arrive (Dialog, Form, Toast with accessible focus handling). Until then it is a dependency without a job.
