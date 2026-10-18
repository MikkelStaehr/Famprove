# Design system – training-app

Contract between `design-lead` (owns this file) and `ui` (builds). Read before any UI work.

- **Part A: Guardrails.** Fixed. Never traded away, whatever the direction.
- **Part B: Direction.** The product's visual identity: **Ember** (visual reset, user 2026-10-14). It replaces Instrument (2026-10-13) and Spurt (2026-09-30); both are history (git). Token values live in `web/src/app/globals.css` (`:root`) and come from Part B.

When Part B and a pattern pack conflict, Part B wins on look and the pack wins on structure. Part A beats both.

The reference mockup (`design/reference/belastning-mockup.html` and its `*.dc.html` sources, variants A, B, C) is **local only and git-ignored**: it holds real numbers and the repo is public. Every value the build needs is written out in this file and in `design/specs/reset-*.md`; never cite a value only by pointing at the reference.

---

## Product profile
- **Product type:** personal training companion. Three screens: **Træning** (today's session, with its full-screen **Fokus** mode for one set at a time), **Belastning** (fitness, fatigue and form over time) and **Analyse** (am I getting fitter: Cykel and Styrke now, Samlet later).
- **Primary users & context:** one user. On the phone in the gym between sets (a quick glance at arm's length, one hand, sweaty fingers) and at home; at the desk to review load.
- **Platform:** mobile web (home-screen bookmark), desktop browser for review. Next.js on Vercel.
- **Locale:** da-DK. Danish UI copy ("Træning", "Belastning", "7 af 24 sæt udført"). Dates `ons. 30. sep.`, times `kl. 09.31`, decimal comma, minus U+2212. Exercise names and sheet cells are shown **exactly as written** in the coach's sheet (often English: "Lat pulldowns", "Bicep of choice").
- **References the user likes:**
  - **Whoop**: dark, calm, one big number per state, colour means status.
  - **intervals.icu**: dense and honest data, serious about the numbers.
  - **Strava**: energetic, clear cards, confident typography.
  - **The 2026-10-14 mockup** (local): dark rounded cards, Geist + Geist Mono, one orange "today" mark, soft zone colours.
- **Pattern packs:** [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md) for `/load` (Belastning) and `/analyse`. `/` (Træning) and `/fokus` (Fokus) are workout screens, not dashboards.

---

# Part A – Guardrails (fixed)

## Principles
1. One screen answers one question. If the user needs to scroll to find the answer, the layout is wrong.
2. Mobile first. Design at 390px, then let it grow. Never the other way round.
3. Show state honestly: loading, empty, error and stale each have their own visible treatment. Never a blank area. A missing value is never drawn or written as 0.
4. Numbers before decoration. On `/load` today's form figure is the largest element; on `/` the session's prescription numbers are; on `/fokus` the current set's reps and kg. Charts support, never replace.
5. One primary action per screen, visually dominant. On `/` that is Begynd / Fortsæt træning; on `/fokus` one per view state (Udført, ~~Til næste sæt~~ **Superseded 2026-10-15 by `fokus-flow.md` §1:** no rest step; the pause view is the next set, its primary `✓ Sæt n udført`. Tilbage til Træning). `/load` and `/analyse` are read-only and have none.

## Tokens contract
Token **names and roles** are fixed here; their **values** come from Part B.
- Colour roles: `--bg`, `--card`, `--border`, `--raised`, `--axis`, `--track`, `--shade-1`, `--shade-2`, `--text`, `--text-muted`, `--today`, `--warning`, `--focus`, the five `--zone-*` roles and the inverse trio `--inverse-bg`, `--inverse-text`, `--inverse-muted`.
- One theme only (dark, `color-scheme: dark`). It meets the accessibility rules below. A light theme, if ever added, must meet them too.
- Spacing: even pixels. Layout steps between cards and sections are 12, 16, 24, 32, 48, 64; inside a component the 2px steps Part B names (3, 6, 10, 14, 18, 22 included) are allowed because they are the direction's measured values. Nothing odd except the 3px control padding.
- Radius: named tokens from Part B (`--radius-card`, `--radius-tile`, `--radius-hero`, `--radius-half`, `--radius-control`, `--radius-segment`, `--radius-button`, `--radius-cell`, and for the tab shell `--radius-stack` 24px: the page sliding in on top, its left corners only; `--radius-sink` 26px: the page sinking back, scaled by t, `design/specs/motion-shell.md`); no raw `rounded-[…]` values in components. *(Stack and sink tokens approved by the user 2026-10-15.)*
- Type: one scale, named by px (`text-11 … text-56`, set by Part B). Tabular numerals for every number that is compared or read mid-set. Glance sizes for `/` and `/fokus` are in "Træning" below.
- Semantic colours carry meaning only with a label, icon or shape, never colour alone. Zone colours are always next to the zone's word.
- Tokens only: no magic values in components. Tailwind's default colour, text-size and radius scales stay removed.

## Layout: phone and desktop (decided 2026-10-13, grid revised 2026-10-14)
Two usage modes, two layouts. **Phone** (390px): in the gym and on the bike; Træning and Fokus live here. **Desktop** (1280px+): at the desk; Belastning and Analyse become real desktop screens, not a stretched phone.

**Breakpoints** (Tailwind's own, no custom ones):
- **Phone layout below `lg` (1024px)**, including tablets: one column, mobile first. `sm` (640px) only switches chart details (more x ticks).
- **Desktop = `lg` (≥ 1024px).** Every desktop rule below is an `lg:` class. Review widths: 390 and 1280.

**Frame.** One centred container for every screen and the nav, never full-bleed:
- Below `lg`: `max-w-content` (720px), gutters 16px, top padding 20px. Cards stack with a **12px** gap.
- From `lg`: `--container-wide` = 79rem (1264px) with 32px gutters, so content is **max 1200px**, centred. Cards sit in the grid below with a **24px** gap.
- Safe areas: the viewport is `viewport-fit=cover`. Gutters are `max(16px, env(safe-area-inset-left/right))`; the top padding is `max(20px, env(safe-area-inset-top))`.

**Two kinds of screen:**
| | Below `lg` | From `lg` |
|---|---|---|
| **Phone-first:** Træning `/`, Fokus `/fokus` | one column of cards, full frame width | **Træning:** two columns, `lg:grid-cols-[7fr_5fr] lg:items-start`, gap 16 (`reset-traening.md` §4, `review-round.md` §7): left = the "I dag" card, then the Sæt card (or the ride card(s) when there is no strength session); right = the compact `WeekCard`, the form card, then the ride card(s) when the Sæt card is on the left. DOM order stays the phone order. **Fokus:** the same single column, `max-w-phone` (35rem = 560px), centred (no nav). Nothing gets bigger. |
| **Desktop:** Belastning `/load`, Analyse `/analyse`, `/analyse/styrke` | one column of cards, phone order | **header row + 3-column card grid**: header row (h1, updated line, notices, section tabs) spans 1200px; under it `lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start`, three columns of 384px. A card spans 1, 2 (792px) or 3 columns. |

**The desktop rule in one line:** the key figure and the small cards sit in column 1; charts span columns 2–3; lists take what is left. DOM order is always the phone order, so reading and tab order don't change with the width; grid placement (`lg:col-start-*`, `lg:row-start-*`) does the rest.
- **Belastning:** placement in `design/specs/review-round.md` §1 (column 1: form card, tiles — two equal tiles, Træthed and Uge N, `grid-cols-2` gap 12 at every width, `fitness-round.md` §2 — week card; the fitness curve spans columns 2–3, rows 1–3; row 4: grid in column 1, TSS bars in columns 2–3), which supersedes `reset-belastning.md` §8.
- **Analyse:** column 1 = the section's hero cards (Cykel: the answers / eFTP figure; Styrke: the lift board), `lg:sticky lg:top-6`; columns 2–3 = the section's chart cards stacked, all 792px wide so shared time axes and `Ingen ture` seams stay aligned. (The old 384px rail + 792px main are exactly columns 1 and 2–3.)
- **Chart heights** are set per card in the screen specs; a chart is never shorter than 160px at 390.
- **Tables from `lg`:** a list that is a table in disguise becomes a real `<table>` in a 2-column card (Cykel's excluded rides: Dato · Årsag · Forklaring · Fakta). Below `lg` it stays the stacked list.
- **States on desktop:** skeletons use the same cards and grid classes as the page (no jump when data arrives). `ErrorState` and `EmptyState` replace the whole grid with one full-width card, text capped at 60ch.

**Navigation (`TabBar`, three tabs: Træning · Belastning · Analyse; never on `/fokus`):**
- **Phone (below `lg`): bottom bar.** `fixed inset-x-0 bottom-0`, `--bg`, 1px `--border` top border. Three equal tabs (`justify-around`), each a link with a 22px line icon above a `text-11` Geist label, gap 4px, `min-w-16`, padding 6px; the bar has 10px top padding and `max(24px, env(safe-area-inset-bottom))` bottom. Each tab's hit area is ≥ 44 × 44. **Indicator** (approved by the user 2026-10-15): a 2px `--text` line on the bar's top edge that follows the swipe position p (not only the settled tab): an outer track one tab wide, translated by p × tab width, holding a 28px inner bar centred in the tab, radius 1px, `aria-hidden` (the current tab is still named by `aria-current`, weight and colour). Bar height `--bottom-bar` = `calc(4.5rem + env(safe-area-inset-bottom))`. `main` gets `padding-bottom: calc(var(--bottom-bar) + 24px)` and `html` gets `scroll-padding-bottom: var(--bottom-bar)` so a focused element is never hidden under the bar (WCAG 2.4.11).
- **Large text:** when the labels would wrap (container query `@max-[20.5rem]` on the nav), the bar is **not fixed**: it falls back to a static strip at the top of the page, without the indicator (current tab by weight and colour only).
- **Desktop (`lg`): top bar.** Static, in the frame, 16px from the top, 24px above the h1, left-aligned: a `SegmentedControl`-style track (`--card` fill, 1px `--border`, `--radius-button`, 4px padding) holding the three tabs as links, each 44px tall, 20px icon + `text-14` Geist 500 label, gap 8px, padding 0 16px, `--radius-control`.
- **Current tab** (every width): `aria-current="page"`, `--text` icon and label, label weight 600; the others `--text-muted`, weight 400. On desktop the current tab also gets the `--raised` fill. Weight plus colour (plus fill on desktop), never colour alone. `/analyse/styrke` marks Analyse.
- DOM: one `<header><nav aria-label="Hovedmenu">` before `<main>` on every width, so keyboard users meet the nav first; only its position changes.

**Spacing and type on desktop:** the type scale is the same at every width (no desktop sizes; the form figure stays the largest element). Card padding is the same as on phone. Prose capped at 60ch.

- Sticky elements: the phone bottom bar (fixed) and Analyse's column 1 (desktop). No sticky header.

## Components (minimum set; Part B gives each its look)
- `Card` – section card: optional `SectionTitle` + right-aligned `MonoCaption` or control, content slot.
- `Tile` – small stat card: `MonoCaption` label, value, one supporting line.
- `SegmentedControl` – a range or option selector: real `<button>`s with `aria-pressed` in a `role="group"` with an `aria-label` (or a radio group with arrow keys; pick one per control and keep it). Each segment's hit area ≥ 44 × 44 even when drawn smaller (padding or a transparent `::after`).
- `TabBar` – the nav above.
- `ZonePill` – zone word in a pill, not interactive.
- `ZoneBar` – five zone segments on the zone scale, the active one in its zone colour, labels under it.
- `ListRow` – day | icon | text | value, 1px `--border` top border.
- `InverseCard` – the light card with one dark 48px button (Træning's "I dag").
- `SectionTitle` (Geist 16/500) and `MonoCaption` (Geist Mono 11–12, `--text-muted`, uppercase).
- `TrendChart` – line chart with a readout row shown on selection only ("Charts: interaction"), empty state built in.
- `WeekCard` – the one week card (`WeekDays` is deleted): `variant="full"` on `/load` (day `<details>` + week switcher), `variant="compact"` on Træning (plain 36px rows, no switcher, current week). Spec `design/specs/review-round.md` §1, §7.
- `EmptyState` – icon, one sentence, optional action. `ErrorState` – what failed, when, retry. `WarningLine` – warning icon + sentence.

## Interaction
- Touch targets ≥ 44×44px. Tap, not hover, for anything essential.
- Feedback < 100ms. Progress shown for anything > 1s.
- Keyboard: every interactive element focusable, visible focus ring, logical tab order.
- Loading: skeleton in the exact shape of the content (the card with grey bars in `--raised`), never a spinner in a card.
- Data freshness: show "updated <time>" wherever data comes from a job; mark stale (> expected interval) as a `WarningLine` (icon + text in `--warning`).
- Undo over confirm: tapping a done set again reopens it; Fokus has Fortryd for the latest tap; Afslut needs no confirm (progress is kept).
- Real buttons: anything that acts is a `<button>` or a link with a visible box or underline; a `SegmentedControl` segment is a button.

## Charts: interaction (every chart, decided 2026-10-13; one calm rule app-wide since 2026-10-14, `design/specs/answers-round.md` §2)
Applies to Belastning's fitness curve, training-day grid and daily TSS bars, Cykel's eFTP, EF and weekly strips, and Styrke's e1RM panels and tonnage strips.
- **Marker.** Selecting a day, ride or week draws a 1px `--text` vertical rule the full height of the plot. On a point chart it snaps to the nearest point and that point gets a 2px `--card` ring (not on Belastning's fitness curve: a hairline only, no dot; `review-round.md` §2). On bar and week strips it sits at the slot centre. On the training-day grid the selected cell gets a 1.5px `--text` outline (offset 1px). The marker is `--text`, never `--today` (`--today` means "today", not "selected").
- **Touch and pen** (`pointerType` ≠ `mouse`): there is **no floating tooltip**. Tap or drag moves the marker, and the values show in the **readout row**. The plot has `touch-action: pan-y`, so a vertical drag still scrolls the page and a horizontal drag scrubs. A tap outside the card's plot clears the selection (a document `pointerdown` outside it), and so does Esc.
- **Readout row.** It sits directly under the x labels, 8px down, inside the card and above the notes, at every width. It reserves a **fixed height**: the height of the chart's tallest possible readout, so nothing jumps between days. Every fact is its own line and may wrap; nothing is truncated. At 200% text it may grow. The **visible** readout follows the finger every frame; the **screen-reader live region** (`aria-live="polite"`, a visually hidden copy) is updated at most once per 150ms while dragging. *(Throttle limited to the live region: approved by the user 2026-10-15.)*
  - Line 1 is `text-13` Geist 500 `--text`: the date or week, then ` · ` and a status when one applies.
  - Line 2 holds the value cells, Geist Mono `text-14` 500 tabular. Each cell is the series' legend swatch, then its label in `--text-muted`, then the value. Cells are 16px apart and wrap.
  - Further lines are `text-13` `--text-muted` facts.
  - **Line-series legend items move into the cells.** Only items with no value stay in the legend: block, deload, excluded, prognose, band, unknown (Belastning's fitness curve: prognose and band only, `fitness-round.md` §1).
- **Nothing at rest** (user 2026-10-14; `/load` first, `review-round.md` §3, then Analyse, `answers-round.md` §2, reversing "Analyse is unchanged"): no readout row, no reserved space, no `Seneste · …`, no value inside a plot and no SVG `<title>` carrying a value. Text inside a plot is only axis ticks, panel/strip labels, `BLOK n`, `INGEN TURE` and `I DAG`; block-best and sheet-1RM marks stay without their numbers. A tap, click, touch drag or keyboard selection shows one readout under that chart; the same point again, Esc or a tap outside that card's plot closes it. sr sentences and hidden tables carry the values for screen readers.
- **Pointer** (`pointerType = mouse`): no tooltip and no hover marker on any chart; hover changes only the cursor (`pointer`). A click selects, as a tap does.
- **Keyboard.** The chart is one focusable group. The first ←/→ selects the latest point, then steps a day, ride or week (the grid also takes ↑/↓ for the day of the week), Esc clears. A keyboard selection uses the readout row. The focus ring sits on the plot.
- **Prognose days:** line 1 reads `tors. 8. okt. · Prognose` (` · efter blokken` and ` · dag anslået` as `load.md` §10c), every value has `≈ `, ranges go to a facts line. Measured days never show `≈`.
- **Gaps:** a gap is never read as 0. On a point chart, if the marker would snap to a point more than 14 days from the tap and the tap lies inside an `Ingen ture` seam, it stays at the tap and line 1 reads the seam (`Ingen ture · 30. sep. 2025 – 10. mar. 2026`). A week with no rides reads `Ingen ture`; a week between blocks reads `mellem blokke`. A missing value is `–`, spoken `ikke registreret`.
- **Readout per chart** (copy and number formats as each spec: decimal comma, U+2212, W whole, EF 2 dp, hours `h:mm t`):

| Chart | Lines | Line 1 | Cells (line 2) | Facts (line 3+) |
|---|---|---|---|---|
| Belastning fitness curve (`reset-belastning.md` §3) | 3 | `ons. 30. sep.` (+ ` · Prognose …`) | `Fitness 45` · `Træthed 41` · `Form +4` | `Program - blok 12 (offseason)` (+ ` · deload`); prognose: the `Cykel ≈ …` / `Styrke ≈ …` basis lines and the range `Spænd: fitness 44 til 49` |
| Belastning training days / TSS bars (`reset-belastning.md` §4–5) | 3 | `tirs. 13. okt.` | `Cykel 0` · `Styrke 72` · `I alt 72` (each from `daily_load`) | before the strength log: `Styrke ikke registreret` (cell `Styrke –`) |
| eFTP pr. tur | 3 | `tirs. 3. jun. 2025 · Udendørs tur` (`Virtuel tur`) | `eFTP 212 W` · `NP 182 W` · `VI 1,08` | `1:45 t · 48,2 km`. Excluded: line 1 `… · Udeladt: For kort`, facts as `analyse.md` §5e |
| VI cell | | | Flagged: value `--warning` + warning icon, sr `, ujævn effekt på en Z2-dag`. No VI: `VI –` | |
| EF (rolige ture) | 3 | `tirs. 3. jun. 2025` | `EF 1,24` · `Trend 1,22` (`Trend –` when null) | `NP 165 W · puls 133 · 1:45 t` |
| Timer og belastning | 3 | `Uge 23 · 2.–8. jun. 2025` (+ ` · indtil videre`) | `Timer 4:30 t` · `Belastning 210 TSS` · `Ture 3` | `1 udeladt fra trends`; zero week: line 2 `Ingen ture`; null load: `Belastning –` + fact `Belastning ikke beregnet` |
| Styrke e1RM | 5 | `Uge 39 · 22.–28. sep. · blok 12, uge 1` (+ suffixes per `analyse-styrke.md` §5c) | none: one line per lift, `Squat 174,1 kg · 140 kg × 5 · RPE 6,5 foreskrevet` (` · blokkens bedste`) | the lift lines are lines 2–4; last fact `1RM i arket: squat 150 kg, bænkpres 100 kg (ikke testet)` (illustrative numbers) (omitted when none) |
| Styrke tonnage | 4 | as e1RM | none: one line per lift, `Squat 2.100 kg · 12 sæt` / `Squat ikke trænet` | lines 2–4 |

## Accessibility checklist (run before merge)
- [ ] WCAG 2.2 AA: text ≥ 4.5:1; large text, icons, chart marks that carry meaning and control borders ≥ 3:1 (Part B's contrast table says which tokens may be used for what).
- [ ] Colour never carries meaning alone (zones have their word, cycling vs strength bars differ by fill pattern, the current tab and selected segment differ by weight).
- [ ] Semantic HTML (`main`, `header`, `nav`, headings in order, `button` vs `a`). Each card with a `SectionTitle` is a `<section aria-labelledby>`.
- [ ] Charts have a text alternative (an sr sentence with the key values, plus the readout row; the training-day grid also a visually hidden table).
- [ ] Icon-only buttons have `aria-label`; decorative icons are `aria-hidden`.
- [ ] Text scales to 200% without horizontal scroll.
- [ ] `prefers-reduced-motion` respected; every motion has a still alternative.

## Technical
- Fonts are self-hosted with `next/font/google` (downloaded at build, never fetched from a third party at runtime), max 2 families: **Geist** and **Geist Mono** (Part B).
- UI library: none. Tailwind is themed from these tokens. **Never a library's default look.**

## Don'ts
- No dashboards with 8 widgets. Max 3 cards above the fold on `/load` (form card, tiles row, top of the week card; `review-round.md` §1).
- No icon-only buttons without `aria-label`.
- No charts without units.
- No decoration that serves neither the direction nor the hierarchy.
- No settings button or page (single user, no settings: the mockup's gear is dropped).

## Project rules
- **Screens:** three routes linked by `TabBar` ("Træning" · "Belastning" · "Analyse"), plus `/fokus` without nav. All UI copy is Danish; exact strings live in `design/specs/traening.md` §6, `design/specs/load.md` §4 and §6, `design/specs/analyse.md` §6, `design/specs/analyse-styrke.md` §4–6 and the `reset-*.md` specs where they replace a string.
  - `/` **Træning** answers "What is my session, and how fresh am I for it?" and `/fokus` **Fokus** answers "What do I lift now?" (specs `traening.md`, `fokus-pause.md`; look `reset-traening.md`).
  - `/load` **Belastning** answers "How loaded am I right now, and is fitness going up?" (behaviour `load.md`; look and layout `reset-belastning.md`).
  - `/analyse` **Analyse** answers "Am I getting fitter?" in two sections, link tabs (`Cykel` · `Styrke`, a `SegmentedControl` look with `aria-current`, no tab roles) under the shared h1:
    - `/analyse` **Cykel** (spec `analyse.md`): the hero is the eFTP figure; `--today` marks only today / the current week.
    - `/analyse/styrke` **Styrke** (spec `analyse-styrke.md`): the hero is the lift board. e1RM provenance (logged vs prescribed RPE) is shown by fill vs hollow and always named in words. The sheet's 1RM is labelled `1RM i arket (ikke testet)` and is a reference only.
    - Look: `reset-analyse.md`. Each section shows its own updated line under the tabs.
- **Pattern packs:** `/load` follows [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md). Conflict: the pack rounds kg to 1 decimal, but this app shows kg as logged (up to 2 decimals). DESIGN.md wins. `/` and `/fokus` are not dashboards, so the pack's "key figure is the largest element" does not apply there; its data-honesty rules do (freshness, gaps never shown as zeros, whole watts).
- **Key figure (hero):** TSB today (form = CTL − ATL) from the latest `daily_load` row, with its zone (Python's `form_zone`) as word, pill and `ZoneBar`.
- **Fitness curve:** CTL per day from `daily_load` (since 2026-01-01) with the 56-day prognose from `daily_projection`; strength blocks marked (`blocks.start_date` → `end_date`, an ongoing block runs to today), deload by a dash pattern, never only colour.
- **Daily load views:** total TSS per day (`daily_load.total_tss`), cycling and strength per day. Strength before the first block's `start_date` (2026-08-10) was trained outside the sheet: it is **ikke registreret**, never 0.
- **Secondary:** the week list (ISO week, Mon–Sun) from `weekly_load` and day details; a week switcher (`?week=2026-W33`) looks back; days expand to their rides and strength exercises.
- **Freshness:** "updated <time>" from the latest `daily_load` row; stale when older than 26 h.
- **Units:** load in TSS; CTL / ATL / TSB in TSS/dag.
- **Form zones** (intervals.icu bands, Python computes them): ≤ −30 Risiko · −30..−10 Optimal · −10..5 Neutral · 5..20 Frisk · ≥ 20 Pause (the mockup's words, user 2026-10-14; were Høj risiko / Gråzone / Overgang). Always shown with their word.
- **Data:** read-only, server-side. The UI never calculates a training metric, a window sum, a max or a min (Python and SQL own them). Drawing scales (bar heights, axis extents, grid shade buckets, positions) are drawing and allowed.

### Week list (Belastning; Danish copy in `design/specs/load.md` §6, look in `reset-belastning.md` §6)
- Title "Uge N" with the date range as a `MonoCaption`; "Tilbage til denne uge" link when another week is shown.
- Switcher: previous / next are real links (44 × 44, `aria-label` names the target week), absent at the ends (an empty 44px box keeps the layout). `scroll={false}` keeps the scroll position and focus.
- Switching weeks re-renders only the list: a `<Suspense>` keyed by the week shows its skeleton; nothing else flashes. Detail errors show an ErrorState inside the card.
- Days are `ListRow`s with native `<details>/<summary>` (keyboard and screen reader without JS) and a 16px chevron. The current week's rows come from the same week source as Træning's week card (user, 2026-10-14): today's planned strength session reads "Styrke · session 2" with `I DAG`, dated planned sessions show their day, and undated ones come last as "– … plan" rows (en dash, spoken "uden dato"). The `I alt` row reads `done / ~planned` (`72 / ~257`, Geist Mono, the planned part muted; `weekly_plan`, an estimate) on the current week while `planned_tss` is not null, else the done figure only, never `/ ~0` (`review-round.md` §1). Rest days (no ride, no strength activity, nothing planned) read "Hvile"; before the strength log they read "Ingen cykling · styrke ikke registreret". Strength sits on its matched activity's date; planned-but-undone sessions are not shown (`traening.md` §8). Each row speaks "cykling N TSS, styrke N TSS, i alt N TSS".
- Missing values show "–", spoken "ikke registreret". A blank kg on a weighted exercise reads "intet kg logget", never "0 kg". Score/set is labelled as the raw score before the strength factor.
- Power data badge: under a ride's name, "Tjek effektdata" `text-13` 500 `--warning` with the warning icon, a native `<details>` summary (44px target) that shows Python's message in `--text-muted`; `title` gives the same text on hover. `app_notices` rows (e.g. "FTP er sat til 230 W, men dine ture peger på 183 W. Cykel-TSS regnes ud fra FTP, så ret den i intervals.icu.") are `WarningLine`s under the updated line.
- VI: after NP and IF on a ride, "VI 1,18" (Python's `ride_metrics.vi`), "VI" an `<abbr>` with "Jævnhed – 1.0 = konstant effekt". Flagged: `--warning` + warning icon + sr ", ujævn effekt på en Z2-dag". No VI: no item.
- Effective kg: where it differs from the logged kg, "· 95 kg effektivt" in `--text-muted`, spoken ", effektivt 95 kg".

### Træning (`/`) and Fokus (`/fokus`) (behaviour; full spec `design/specs/traening.md`, look `design/specs/reset-traening.md`)
- **Use:** a companion for the gym and the handlebar, read at arm's length (≈ 60–80 cm). `/` **Træning** is the overview of the day: the form figure with its zone word and one-line hint, the open strength session in the "I dag" `InverseCard` with its one primary action (**Begynd træning** / **Fortsæt træning**), ride and rest cards. `/fokus` **Fokus** is a full-screen mode for one set at a time, reached from that button; it is not a tab.
- **Data:** server-side, read-only except the **set log**. Python computes every number, including target watts and the suggested kg; the web only formats. The rest timer (now − last done tap) is a clock, not a training metric. The date is the Europe/Copenhagen date at request time.
- **Glance sizes:** Fokus: reps and the kg figure `text-44` Geist Mono 500, the rest timer and warm-up clock `text-56` (`reset-fokus.md`, review 2026-10-14): the largest things on the screen. Træning: ≥ `text-24` Geist Mono 500 tabular for anything read mid-set or mid-interval (reps, prescription, target watts); `text-16`–`text-20` for exercise names and set lines; nothing in a session card smaller than 13px.
- **As written vs computed:** sheet strings are shown verbatim ("8 - 12", "RPE 6 - 7", "-12.5%"); only screen-reader text rewrites " - " to " til ". ~~The suggested kg always carries the word `Forslag` (a `MonoCaption` above it) and~~ The kg never sits in the prescription line; last week's kg carries `Sidste uge`. ~~The sheet's pre-filled kg is not shown on Træning or Fokus.~~ **Superseded 2026-10-15 by `fokus-kg.md`:** today's kg under `I DAG` (the sheet's kg first; computed shown `~`), last week's kg smaller under it; no "Forslag".
- **Set lines (Træning):** one group per sheet row; each set is a `<label>` wrapping a native checkbox, ≥ 44px, the whole line is the target, accessible name the full sentence (`Squat, sæt 1 af 2, 5 reps ved RPE 7, ~~forslag~~ 142,5 kg, sidste uge 140 kg`; "forslag" superseded 2026-10-15 by `fokus-kg.md`, today's kg under `I DAG`). Open, done and skipped differ by shape (empty ring, filled disc with ✓, ring with a minus bar + the word), never colour alone. Lines never move or reorder. Tapping a done set reopens it.
- **Set state:** lives in the set log and is read back on every load. Taps are optimistic (< 100ms) and saved in order through the one server action; kg is never written. A failed save keeps the tick and shows a `WarningLine` with **Gem igen**: "1 sæt er ikke gemt. De står her, men forsvinder, hvis siden genindlæses." Under DEV_TODAY / DEV_FIXTURE nothing is written: "Testvisning: sæt gemmes ikke."
- **Fokus:** no TabBar. Top bar: **Afslut** (link to `/`, no write, no confirm), the count ("0/19", spoken "0 af 19 sæt udført"), the progress bar, and a reserved 44px row with **Fortryd** (accessible name says what it undoes). View states (`design/specs/fokus-flow.md`, user 2026-10-15: no start step, the pause screen is the next set): set/pause (one layout: rest timer, the next set, **✓ Sæt n udført**; Spring over), warm-up (**✓ Opvarmning udført**), finished (**Tilbage til Træning**, dark). The primary is a full-width 56px button pinned to the bottom on a view taller than the screen. Reload rebuilds the view from the log. A wake lock holds from the session's first tap until finished; one vibration at the recommended minimum rest. Focus moves to the next view's primary; one polite status region announces each set change; the timer is never announced on its own.
- **Ride steps:** label and duration left; watts right ("238 W", unit included), % FTP below in muted. Repeat groups get "Gentag N gange" with their steps indented 16px.
- **Order (Træning, `review-round.md` §7, §9):** header (title, updated line), the compact `WeekCard` (current week, first card), the "I dag" card with the primary button, form figure + hint, then ride card(s), the strength list (one collapsed row per exercise: name, set dots and a chevron only; with a variant the name is the variant's display name with the exercise name muted under it, `design/specs/variants.md`; **every exercise starts collapsed**; tap to expand to prescription, suggestion when there is one, `SIDSTE UGE` and the set rows; `aria-expanded`; "Intet forslag" is never shown or spoken: user, 2026-10-14), and the rest card (only when no ride today and no strength session left this week). The primary action is above the fold on every day (viewport minus `--bottom-bar`).
- **Variants** (`design/specs/variants.md`, user 2026-10-14): where a set has a variant, Træning and Fokus title it with the variant's display name verbatim and the exercise name muted under it (never truncated); screen-reader text says both (`DB Preacher Curl, Bicep of choice, …`). A new variant has no suggestion and no last week: `Ny variant – intet fra sidste uge`. No variant looks exactly as before.
- **Freshness:** the same updated line as `/load`; stale sentence "Form og styrkeprogrammet kan være forældet." Fokus shows staleness only when stale. A failed plan read is an ErrorState, never a rest day.

---

# Part B – Direction: Ember (visual reset, user 2026-10-14)

**History:** Spurt (2026-09-30) → Instrument (2026-10-13, Revisions 1–5) → **Ember** (2026-10-14), from the user's mockup of the Belastning screen. Instrument's revisions, token table, signature elements, "one living element" rule, grain and registration marks are retired (git history).

## Personality
**Warm, calm, exact.** Dark warm-grey cards on near-black, cream text, numbers in a mono face, and one ember of orange that only ever means "today". Colour is otherwise spent on one thing: the form zone, in soft muted tones and always with its word. Recognisable by the one orange cell in the training-day grid and the week card's `I DAG`, by the smooth cream fitness curve that turns dotted at today's ring, and by today's form figure set large in its zone colour. (No today line on the fitness curve: user, 2026-10-14, "red only for the risk zone".)

## Colour tokens (`:root`, dark only, `color-scheme: dark`)
| Token | Value | Role |
|---|---|---|
| `--bg` | #111110 | page; the track inside a `SegmentedControl`; the bottom bar |
| `--card` | #1A1A19 | card and tile fill |
| `--border` | #262624 | card border (1px), `ListRow` dividers, dashed gridlines (decorative only) |
| `--raised` | #2A2A28 | selected segment fill, current desktop tab, icon-button border, skeleton bars, tooltip border |
| `--axis` | #3A3936 | chart baselines, empty-bar stubs |
| `--track` | #232321 | rest cell in the training-day grid, empty day box |
| `--shade-1` | #4A4844 | grid level 1 |
| `--shade-2` | #9C968B | grid level 2; strength hatching and its 1px outline |
| `--text` | #EDE8DF | text, grid level 3, cycling bars, the fitness line, icons, marker |
| `--text-muted` | #8F897E | secondary text, labels, captions, prognose line, inactive tabs and segments, block brackets |
| `--today` | #E0612F | **only the today marker**: the today outline in the grid, the `I DAG` caption (week card; Analyse › Cykel's today line). Not on Belastning's fitness curve. Never a fill, never a button, never on the inverse card |
| `--rec` | #F2555A | **only the recording indicator** (user 2026-10-18, slice `rec-indicator`): the pulsing dot before Fokus's recording counter, nothing else. Part B's one red. Never text, a fill, a button, a border, a chart mark, an error or a warning (those stay `--warning`), never on the inverse card (2.77:1). Always next to the running counter and the word `OPTAGER` |
| `--warning` | #C9A86A | stale line, `WarningLine`, "Tjek effektdata", flagged VI; always with the warning icon and words |
| `--focus` | #EDE8DF | 2px focus ring, 2px offset; on `InverseCard` the ring is `--inverse-text` |
| `--zone-risk` | #D9826B | Risiko |
| `--zone-optimal` | #8FBF8A | Optimal |
| `--zone-neutral` | #B5AFA4 | Neutral |
| `--zone-fresh` | #8DB4C9 | Frisk |
| `--zone-transition` | #C9A86A | Pause |
| `--inverse-bg` | #EDE8DF | the "I dag" card fill |
| `--inverse-text` | #141413 | text on it; the dark button fill on it |
| `--inverse-muted` | #5C5851 | secondary text and captions on it |

**Recording colour rule** (user 2026-10-18). `--rec` exists only while a clip records and only as the dot; when recording stops the dot goes with the strip. Orange stays only the today marker; the two never meet on one screen state that matters (the recording strip has no today mark). The dot is never the only carrier: the counter runs and `OPTAGER` names it.

**Zone colour rule.** A zone colour is used for: today's form figure, the active `ZoneBar` segment and its label, the `ZonePill` (text + 1px border at 40 % + fill at 8 % of the zone colour) and Træning's form figure. It is also used for the ramp verdict in the fitness curve header (`Falder` neutral, `Sund opbygning` optimal, `Hård opbygning` transition, `For hurtigt` risk; a plain word, never a pill; `fitness-round.md` §1). It is **always next to the zone's word** or the verdict's word (pill, active label, hint sentence or verdict). Inactive `ZoneBar` segments are their zone colour at 30 % opacity (decorative). Zone colours never appear in charts, bars, buttons or tabs.

**Contrast** (computed by `design-lead` 2026-10-14 with the WCAG 2.x formula; `tester` recomputes at render time):
| Foreground | on `--bg` | on `--card` | Use |
|---|---|---|---|
| `--text` | 15.48 | 14.27 | any text |
| `--text-muted` | 5.44 | 5.02 | any text (≥ 4.5); on `--raised` 4.14: **not for text on a selected segment** |
| `--today` | 5.33 | 4.91 | the `I DAG` caption (text OK), today line/outline (≥ 3:1) |
| `--rec` | 5.60 | 5.16 | the recording dot only (≥ 3:1 needed; also ≥ 3:1 at the pulse's lowest opacity 0.7 on `--card`: 3.12). Computed by `design-lead` 2026-10-18; `tester` recomputes at render |
| `--zone-risk` | 6.62 | 6.10 | text and marks |
| `--zone-optimal` | 8.99 | 8.28 | text and marks |
| `--zone-neutral` | 8.67 | 7.99 | text and marks |
| `--zone-fresh` | 8.55 | 7.88 | text and marks |
| `--zone-transition` / `--warning` | 8.36 | 7.71 | text and marks |
| `--shade-2` | 6.43 | 5.93 | strength hatch outline, grid level 2 (≥ 3:1) |
| `--shade-1` | 2.07 | 1.91 | grid level 1 only: below 3:1, so the grid's values are also in its readout and hidden table (`reset-belastning.md` §4) |
| `--axis`, `--border`, `--raised`, `--track` | 1.64 / 1.25 / 1.31 / 1.20 | 1.51 / 1.15 / 1.21 / 1.11 | decoration only (gridlines, dividers, fills); never the only carrier of meaning, never a control border that has to be seen |
| `--inverse-muted` on `--inverse-bg` | | | 5.79 |
| `--inverse-text` on `--inverse-bg` (and `--text` on the dark button) | | | 15.11 |
| `--today` on `--inverse-bg` | | | 2.91: **forbidden** |

## Type
- **Geist** (400, 500, 600) → `--font-geist`, `font-sans`: headings, sentences, tab labels. **Geist Mono** (400, 500) → `--font-geist-mono`, `font-mono`: every number, the small uppercase labels, and **every button label** (`text-button`, user 2026-10-15, `design/specs/button-type.md`). Both via `next/font/google`, subset `latin` (æøå, ·, –, U+2212). Glyphs outside it (✓, arrows ↑↓→, ≈ if missing) are inline SVG or verified to be in the subset; nothing may fall back to a system font (`ui` checks by rendering).
- Scale (px; line-height in brackets):

| Token | Face | Use |
|---|---|---|
| `rec-counter` 64px (1) | Mono 600, tabular | the recording counter in Fokus ("● 0:12", readable at 3 m; `video-record.md`), the only 64 px text |
| `text-56` (1) | Mono 500, −0.03em | today's form figure on `/load`; Fokus rest timer, warm-up clock, finished-view counts |
| `text-48` (1) | Mono 500, −0.03em | Belastning's fitness figure in the curve card header (`fitness-round.md` §1) |
| `text-44` (1) | Mono 500, −0.03em | Fokus reps and kg figures (`reset-fokus.md`) |
| `text-40` (1) | Mono 500, −0.03em | Analyse hero figures: Cykel answer numbers, Styrke lift-board values (`reset-analyse-*.md`) |
| `text-32` (1.15) | Geist 600, −0.01em · Mono 500 | Fokus exercise name (Geist); Fokus reps-stepper value (Mono) |
| `text-28` (1.1) | Mono 500 | half-card figures (Træning form figure; C's half card) |
| `text-24` (1.1) | Mono 500 | `Tile` values; prescription numbers on Træning |
| `text-22` (1.2) | Geist 600, −0.01em | page h1 |
| `text-20` (1.25) | Geist 600, −0.01em | `InverseCard` title |
| `text-16` (1.35) | Geist 500 | `SectionTitle` |
| `text-15` (1.4) | Geist 400/500 | hint sentence beside the form figure (muted) |
| `text-button` (1.2) | Mono 500, 15px, uppercase (CSS `text-transform`; the source text stays sentence case for screen readers), letter-spacing 0.04em | every button label on Træning and Fokus (Buttons below; user 2026-10-15: Belastning's FTP choices keep their look) |
| `text-14` (1.4) | Geist 400 · Mono 400/500 | `ListRow` text; row values (mono); readout cells (mono) |
| `text-13` (1.4) | Geist 400 | supporting sentences, notes, readout line 1 and facts |
| `text-12` (1.3) | Mono 400 | `MonoCaption` large: card captions (`FORM I DAG`), date ranges, the updated line, `ListRow` day, segment labels, `ZonePill` |
| `text-11` (1.3) | Mono 400/500 | `MonoCaption` small: tile labels and tile supporting lines, legends, axis labels, `ZoneBar` labels, `I DAG`, tab labels (Geist) |
| `text-10` (1.2) | Mono 400/500 | only the training-day grid's ISO week numbers, [A9] |

- Nothing smaller than 11px anywhere (the mockup's 10px axis labels become 11px), with one exception: **[A9] user override (2026-10-14):** the training-day grid's ISO week numbers are `text-10` Geist Mono, because 12 two-digit numbers must sit centred on 20px cells. Guardrail kept: they are `--text-muted` / `--text` on `--card` (≥ 4.5:1, computed by `ui` at render), decorative (`aria-hidden`; the hidden table holds the dates), and carry no meaning alone (the current week also differs by weight). Captions: labels uppercase (`FORM I DAG`, `FITNESS`, `UGE 42`); values in a caption slot (date ranges, `12 uger`, `- - - prognose`) as written; no letter-spacing. Numbers: tabular (`font-variant-numeric: tabular-nums`, Geist Mono is tabular by nature).

## Shape
| Token | px | Use |
|---|---|---|
| `--radius-hero` | 26 | the fitness-curve card (Belastning), a section's hero card |
| `--radius-card` | 22 | section cards |
| `--radius-half` | 20 | half-width cards, `InverseCard`, the week strip card |
| `--radius-tile` | 18 | `Tile` |
| `--radius-button` | 14 | buttons, icon buttons (44 × 44), the desktop tab track |
| `--radius-control` | 10 | `SegmentedControl` track, desktop tab, week-strip day box, tooltip |
| `--radius-segment` | 7 | a segment |
| `--radius-cell` | 4 | training-day grid cell (3px on legend swatches and bar tops) |
| `--radius-stack` | 24 | tab shell: the page sliding in on top, left corners only, while it is off its rest position |
| `--radius-sink` | 26 | tab shell: the page sinking back, × t (0 at rest, 26 when fully covered) |
| pill | 999 | `ZonePill` |
- Cards: `--card` fill + 1px `--border` border. **No shadows anywhere**, with one exception: `--shadow-stack: -18px 0 36px rgba(0,0,0,.55)` on the tab-shell page sliding in on top, only while it moves (0 < d < 1). It reads as a page edge, not as card elevation. Elevation is fill: `--bg` < `--card` < `--raised`; the inverse card is the one light surface on a screen.
- Lines: borders 1px; icons 1.5px stroke; chart main line 2px; today line 1.5px (Analyse › Cykel only).

## Space and density
Compact cards, generous radius. Phone: page padding 20px top / 16px sides, 12px between cards. Card padding: section card 18px (header row 18 18 14 when a chart follows), form card 20px, hero card 22px 20px 16px, half card 16px, tile 14px. Inside a card: 14–18px between groups, 6–10px inside a group, 4px between a caption and its value. `ListRow` padding 10px 0, gap 12px. Desktop: same paddings, 24px grid gap.

**Fokus strip height** `--h-fokus-strip` = 11.1125rem (177.8px, the rest card's measured height on 2026-10-17; replaces the hand-typed `min-h-[11.1125rem]` in `RecordParts.tsx`). Both the rest card and the recording strip use `min-height: var(--h-fokus-strip)`, so they match by construction and the hero card never moves when recording starts or stops. `min-height`, never `height`: at 200 % text both grow instead of clipping. If either's content outgrows it, raise the token, never one card.

**Recording counter** (user 2026-10-18: readable at 3 m, the phone on a stand): `● 0:12` on one row, bottom of the strip's left column. Dot: a 20px CSS disc in `--rec`, `aria-hidden`, vertically centred on the digits, 8px gap. Counter: Geist Mono 600, 64px, line-height 1 (64px), `--text`, tabular, `m:ss` up to `15:00`. Reason: the rule of thumb is ≈ 8 arcmin of digit height for a glance read at a distance (1.6× a 20/20 letter's 5′; digits are familiar shapes): 3 m × tan 8′ ≈ 7 mm; Geist Mono's digits are ≈ 0.7 em, so 64px gives ≈ 45 CSS px ≈ 7 mm on a ~160 CSS-px-per-inch Android phone (rendered height computed by `ui` at render). It is the largest that fits: 390 − 2×16 page − 2×16 card − 88 preview − 12 gap = 226px; dot 20 + gap 8 + `15:00` at 5 × 0.6 em × 64 = 192 → 220px. The counter is `--text` (14.27:1), not red: contrast, not colour, reads at 3 m.

## Icons
(Rewritten 2026-10-15, slice `motion-icons`; spec `design/specs/motion-numbers-icons.md`.) **One library: `lucide-react`.** Line icons, 24 viewBox, `fill="none"`, `stroke="currentColor"`, **stroke-width 1.5** (scaled with size, not `absoluteStrokeWidth`), **round caps and joins** (Lucide's; replaces the earlier butt caps). Sizes: 22 (phone tab bar), 20 (desktop tabs, card corners, icon buttons), 18 (`ListRow`, button trailing arrow), 16 (`WarningLine`, chevrons). Always `aria-hidden` next to text; an icon-only button has `aria-label`. `web/src/components/icons.tsx` is the only file that imports Lucide: a name → component map, so call sites use `<Icon name=…>` unchanged.
- **Lucide map:** bike → `Bike` · arrow-right (Begynd træning) → `ArrowRight` · chevron-left/right/down → `ChevronLeft` / `ChevronRight` / `ChevronDown` · warning → `TriangleAlert` · check → `Check` · arrow-up / arrow-down / arrow-flat (deltas) → `ArrowUp` / `ArrowDown` / `ArrowRight` · arrow-up-right / arrow-down-right (Analyse › Cykel's answer direction) → `ArrowUpRight` / `ArrowDownRight` · x → `X` · minus → `Minus` · plus → `Plus` · refresh (Hent data nu, 16px after the "opdateret" time; spins while fetching) → `RotateCw` · video (2026-10-17, `video-library.md`): play → `Play` · star → `Star` (on = `fill="currentColor"` + `aria-pressed`, the one filled icon) · share → `Share2` · trash → `Trash2`.
- **Own paths (the three tab icons, everywhere their name is used; animatable parts, same stroke and round caps):** **barbell** (strength, Træning tab) `M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12` in one group; **trend** (Belastning tab) `M3 17l5-6 4 3 4-7 5 5` with `pathLength="1"`; **bars** (Analyse tab) three paths `M5 20V11` · `M11 20V5` · `M17 20v-7` + baseline `M2.5 20.5h19`. Only the newly chosen tab's icon animates, once (Motion table); never on first paint or under reduced motion.
- No other icon source (no inline SVG icons in components, no second library).

## Components (look)
- **Card:** `--card`, 1px `--border`, `--radius-card`, padding 18px, column gap 14px. Header row: `SectionTitle` left, `MonoCaption` text-12 or a control right, `justify-between`, `items-center`.
- **Tile:** `--card`, 1px `--border`, `--radius-tile`, padding 14px, gap 6px: label `text-11` mono muted uppercase; value `text-24` mono 500 `--text`; supporting line `text-11` mono (`--text` when it carries a direction, else muted).
- **SegmentedControl:** track `--bg`, 1px `--border`, `--radius-control`, padding 3px, gap 2px, Geist Mono `text-12`. Segment padding 6px 9px (7px 10px on a hero card), `--radius-segment`. Selected: `--raised` fill, `--text`, weight 500, `aria-pressed="true"`. Others: transparent, `--text-muted`, weight 400. Hit area ≥ 44 × 44 via a transparent `::before` (`inset: -8px -2px`, no overlap with neighbours: the 2px gap plus the vertical extension). Focus ring around the segment.
- **ZonePill:** Geist Mono `text-12`, zone colour text, 1px border zone colour at 40 %, fill zone colour at 8 %, radius 999, padding 4px 10px.
- **ZoneBar:** 8px tall row of five segments, gap 3px, outer ends rounded 4px; widths on the zone scale (−40…+30 TSS/dag, `zone-scale.ts`: 10/20/15/15/10). Active segment = its zone colour at 100 %; others their colour at 30 %. A 2 × 14px `--text` tick at today's TSB (the existing marker; out of range: pinned to the end with an 8px outward chevron). Labels under (gap 8px): Geist Mono `text-11`, `justify-between`, inactive `--text-muted` 400, active in its zone colour 500.
- **ListRow:** flex, `items-center`, gap 12px, padding 10px 0, 1px `--border` top border. Day: 36px wide, Geist Mono `text-12` `--text-muted` (today `--text`). Icon 18px (`--text` done, `--text-muted` otherwise). Text: `flex-1`, Geist `text-14` (`--text`, or `--text-muted` for rest/missing). Value: Geist Mono `text-14` `--text`, right-aligned.
- **InverseCard:** `--inverse-bg`, no border, `--radius-half`, padding 18px, gap 12px. Caption Geist Mono `text-11` `--inverse-muted` uppercase + a 20px icon right in `--inverse-text`; title `text-20` Geist 600 `--inverse-text`; one supporting line `text-13` `--inverse-muted`; its button (**Begynd træning** / **Fortsæt træning**) is a **dark button** (Buttons below): 48px tall, full width, `--radius-button`, fill `--inverse-text`, 1px `--text-muted` border, label `--text` `text-button` with a trailing 18px arrow-right, gap 8px, 4px extra top margin. `:active` lowers the button's opacity to 0.85.
- **Buttons** (user 2026-10-15, slice `button-type`, spec `design/specs/button-type.md`). Every label is `text-button` (Geist Mono 15/500, uppercase, 0.04em), icons 18px 1.5px stroke, gap 8px, `--radius-button`. Two kinds only:
  - **Light = the one done.** `--inverse-bg` fill, `--inverse-text` label, no border, 56px, full width in Fokus's dock. Only Fokus's done: **✓ Sæt n udført** (the `check` icon, never the ✓ character) and the warm-up's **✓ Opvarmning udført** (the done of set 0, `fokus-flow.md`). At most one per screen; Træning has none.
  - **Dark = everything else.** `--card` fill (`--inverse-text` on the `InverseCard`), 1px `--text-muted` border (5.44:1 on `--bg`, 5.02:1 on `--card`), `--text` label; min-height 44 (48 in a card, 56 for the stepper and the feel choices). Named: **Begynd / Fortsæt træning**, **Afslut** (x icon), **Fortryd**, **Spring over** (no longer a text link), **Tilbage til Træning**, the feel choices **Lettere · Som ventet · Hårdere** (three separate buttons, gap 8px; selected = `--raised` fill + 16px check + `aria-pressed`, never fill alone; labels may wrap to two lines), the stepper **− / +** (56 × 56, icons, sr `Færre reps` / `Flere reps`), **Gem igen** and **Prøv igen**. Hele noten is gone (notes removed 2026-10-15). Icon button = 44 × 44, `--card` fill, 1px `--raised` border, `--radius-button`, 20px icon; its border is decorative, so its icon (≥ 3:1) and `aria-label` carry it. Text link = `--text`, underlined, ≥ 44px tall hit area.
- **Superset seam** (user 2026-10-15, slice `supersets`, spec `design/specs/supersets.md`): between two consecutive exercise rows on Træning, a 44px seam with a compact dark toggle `Superset` (32px visible, 44 hit, `arrow-left-right` icon, `aria-pressed`); on = `--raised` fill + check icon + a 2px `--text` rail joining the pair; locked = static Geist Mono 13 caps `--text-muted`. Fill never carries "paired" alone.
- **Bottom sheet** (user 2026-10-17, slice `fokus-sheet`, spec `design/specs/fokus-sheet.md`): anchored to the bottom, `--card` fill, 1px `--border` top edge, top corners `--radius-hero`, decorative grabber 36 × 4 `--shade-1`, a header with its title (the dialog label) and a 44 × 44 `Luk` icon button. Scrim `#000` at 0.55 behind it; whatever must stay live (Fokus's rest strip) sits above the scrim. `role="dialog"` + `aria-modal`, background `inert`, focus trapped and returned. Closes by Luk, scrim, Escape, back gesture, swipe down (> 25 % or a flick). Never the only way to reach something.
- **WarningLine:** 16px warning icon in `--warning` + Geist `text-13` `--text` sentence, gap 8px.
- **Skeleton:** the card itself with `--raised` bars at the content's sizes, radius 4; no shimmer under reduced motion, a 1.2s opacity pulse otherwise.

## Chart marks
- **Main line** (fitness): 2px `--text`, round joins, drawn as a monotone cubic curve (never overshoots). On Belastning it runs through **weekly anchors** (the window's first measured day, each ISO-week Sunday, the last measured day; prognose: the last measured day, each prognose Sunday, the last prognose day), so it reads as a trend, not a sawtooth; the daily value is in the readout (`review-round.md` §2). The prognose line and its band edges use the same anchors. Today's point: r 5, `--bg` fill, 2px `--text` stroke on the last measured anchor, or r 4 filled `--text` when a second series ends there. It has no legend item on Belastning (`fitness-round.md` §1).
- **Belastning curve card header** (`fitness-round.md` §1): `FITNESS` `MonoCaption`; the figure is fitness with one decimal in `text-48`, with the ramp `↑ 3,1 / 7 d` in Mono `text-14` beside it; the verdict word sits under it. There is no unit caption. The legend holds only `- - - prognose` and `spænd` (when a band is drawn); no `○ i dag`, no `Blok`. Y axis: the first step in 1/2/5/10/20… that gives ≤ 4 intervals; the bottom is the largest step multiple ≤ the window's lowest value (≥ 0).
- **Prognose:** the same series continued as a 1.5px `--text-muted` line, dashed 3 4. Legend text `- - - prognose` (Geist Mono `text-11` muted). Its band (after the block, `DEV_FIXTURE=band`): an area between `ctl_low` and `ctl_high` in `--text-muted` at 12 % opacity, no stroke; legend `spænd`.
- **Gridlines:** 1px `--border` dashed 2 4, decorative. Baseline (zero / bottom): 1px `--axis` solid. Axis labels: Geist Mono `text-11` `--text-muted`; y labels inside the plot at the right edge, end-anchored, 4px above their gridline.
- **Today:** a 1.5px `--today` vertical line the full plot height, with `I DAG` Geist Mono `text-11` `--today` end-anchored 4px left of it at the bottom, on Analyse › Cykel's daily charts only. **Not on Belastning's fitness curve** (user, 2026-10-14: today is its ring) and not on weekly charts whose last point is the current week (Analyse › Styrke: user, 2026-10-14, a lone tick without a date). In the grid, today's cell gets a 1.5px `--today` outline, offset 1px.
- **Strength blocks:** a bracket in a 16px strip at the top of the plot: 1.5px `--text-muted` line from start to end (ongoing: to today) with 6px down-ticks at both ends, label `Blok 12` (`B12` when the bracket is narrower than the label + 8px) Geist Mono `text-11` muted, centred above; the deload part dashed 3 3. Omitted when narrower than 12px.
- **Daily TSS bars:** cycling = solid `--text`; strength = diagonal hatch (135°, 2px `--shade-2` lines every 4px) with a 1px `--shade-2` outline; stacked (cycling at the bottom) when a day has both; top corners `--radius` 3px on the top segment only; a day with 0 total = a 2px `--axis` stub; a day whose strength is not registered and has no ride = no stub (a gap) under the "styrke ikke registreret" bracket.
- **Training-day grid:** 20 × 20 cells, gap 4px, `--radius-cell`; shades `--track` (rest) / `--shade-1` / `--shade-2` / `--text`; a day whose load is unknown (no ride, strength not registered) = no fill, 1px dashed `--shade-1` outline (the mockup's planned-day box), named in the legend and caption. Buckets in `reset-belastning.md` §4.
- **Training-day grid week numbers:** the ISO week above each column, Geist Mono `text-10` [A9] `--text-muted`, centred on the 20px cell, 6px above row 1; the current week's in `--text` 500; `aria-hidden`. Day labels: all seven, `M T O T F L S`.
- Every chart has an sr sentence, units on an axis or in the caption (exception: Belastning's fitness curve, whose `TSS/dag` lives in the readout cells and sr sentence), and the readout row. No 3D, no gradients, no shadows.

## Motion (rewritten 2026-10-15, slice `motion-shell`; reference `design/reference/famprove-motion.html`, local)
Calm and quick; motion confirms where you are and what changed, never decorates. One ease, `--ease: cubic-bezier(.2,.8,.2,1)`, unless the row names another. JS-driven easings: easeOutQuart = 1 − (1 − t)⁴, easeOutCubic = 1 − (1 − t)³.

| What | Duration | Ease / timing | Spec |
|---|---|---|---|
| Tab shell card stack (swipe release, tab tap, back/forward) | 440 ms | easeOutQuart (rAF) | `motion-shell.md` |
| Tab indicator | follows p every frame; no own transition | | `motion-shell.md` |
| Fitness curve draw-in (stroke-dashoffset) | 900 ms | `--ease`; today's ring fades in at 750 ms (250 ms), the prognose at 850 ms (500 ms) | |
| Range change (4U / 12U / Sæson): path morph | 420 ms | easeOutCubic (rAF); gridlines fade out and back | |
| Number roll (digit columns) | 750 ms | `--ease`, +45 ms delay per digit, left to right | |
| Unfold (exercise row, `grid-template-rows` 0fr → 1fr) | 380 ms | `--ease`; chevron rotates 350 ms | |
| Set check: ✓ stroke draw / set dot pop (0.4 → 1.35 → 1) | 400 ms / 400 ms | `--ease` | |
| Bars grow (scaleY from the bottom; Analyse's weekly and tonnage strips) on entering Analyse or switching Cykel/Styrke | 600 ms | `--ease`, 40 ms stagger per bar, the whole ripple capped at the reference's 480 ms (12 bars): min(40, 480/(n−1)) ms with ~94 weekly bars; starts after the 440 ms stack settles | |
| Analyse lines draw in (eFTP, EF trend, e1RM; stroke-dashoffset) on entering Analyse or switching Cykel/Styrke | 800 ms | `--ease`, after the stack settles line i starts at 200 + 120·i ms; its dots and markers fade in after it (250 ms); the FTP level line stays put | |
| Tab icon on becoming current: barbell lift / trend line draw / bars grow | 600 / 650 / 500 ms | `--ease`; the bars icon's three bars 70 ms apart | |
| Bottom sheet open / close (translateY; scrim fades with it); swipe release that does not close settles back | 380 ms / 240 ms; 240 ms | `--ease` (`EASE_EMBER`) | `fokus-sheet.md` |
| Segment pill slide; ZoneBar tick to today | 350 ms; 900 ms | `--ease` | |
| Segment and tab colour; `<details>` chevron | 120 ms ease-out; 150 ms | | |
| Button press | opacity 0.85 on `:active`, no scale | | |
| Skeleton pulse | 1.2 s opacity | | |
| Recording dot pulse (`--dur-rec-pulse`) | 1.2 s per cycle, infinite, only while recording | `ease-in-out`, opacity 1 → 0.7 → 1 (0.7 keeps ≥ 3:1 on `--card`); no scale, so nothing beside it moves. Reduced motion: no pulse, the dot stays at opacity 1 | `video-record.md` §5, §11 |
| Rest timer | steps once a second, no transition | | |

- **Sinking page:** darkened by a black scrim at opacity 0.55 × t over the page, never `filter: brightness` (same pixels on a dark page; opacity is cheaper).
- **Nothing animates on first paint**, with one exception (user, 2026-10-15): the fitness curve draws itself when the app opens on Belastning, once per browser session (a reload in the same session stays still), as the reference does at boot. A hard load, reload or `router.refresh()` shows the final state at once: curves drawn, bars full, numbers set, current tab icon still. Motion plays only on a change the user caused (a tab change, a range change, a tap, a new value after ↻).
- **`prefers-reduced-motion: reduce`:** everything is off: every duration and delay is 0, the card stack snaps, the curve and bars appear complete, digits change in place, the skeleton is static.
