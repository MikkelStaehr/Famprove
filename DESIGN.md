# Design system – training-app

Contract between `design-lead` (owns this file) and `ui` (builds). Read before any UI work.

- **Part A: Guardrails.** Fixed. Never traded away, whatever the direction.
- **Part B: Direction.** The product's visual identity: **Spurt**, with Logbog's zone bar and a dark theme derived from Ro (chosen 2026-09-30). Token values live in `web/src/app/globals.css` and come from Part B.

When Part B and a pattern pack conflict, Part B wins on look and the pack wins on structure. Part A beats both.

---

## Product profile
- **Product type:** personal training companion. Three screens: **I dag** (what to do in today's session), **Belastning** (fitness, fatigue and form over time) and **Analyse** (am I getting fitter: Cykel and Styrke now, Samlet later).
- **Primary users & context:** one user. On the phone in the gym between sets — a quick glance at arm's length, one hand, sweaty fingers — and at home; at the desk to review load.
- **Platform:** mobile web (home-screen bookmark), desktop browser for review. Next.js on Vercel.
- **Locale:** da-DK. Danish UI copy ("I dag", "Belastning", "2 af 8 udført"). Dates `ons. 30. sep.`, times `kl. 09.31`, decimal comma. Exercise names and sheet cells are shown **exactly as written** in the coach's sheet (often English: "Lat pulldowns", "Bicep of choice").
- **References the user likes:**
  - **Whoop** — dark, calm, one big number per state, colour means status.
  - **intervals.icu** — dense and honest data, serious about the numbers.
  - **Strava** — energetic, clear cards, confident typography.
- **Pattern packs:** [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md) for `/load` (Belastning). `/` (I dag) is a checklist/workout screen, not a dashboard.

---

# Part A – Guardrails (fixed)

## Principles
1. One screen answers one question. If the user needs to scroll to find the answer, the layout is wrong.
2. Mobile first. Design at 390px, then let it grow. Never the other way round.
3. Show state honestly: loading, empty, error and stale each have their own visible treatment. Never a blank area.
4. Numbers before decoration. On `/load` the key figure is the largest element; on `/` the session's prescription numbers are. Charts support, never replace.
5. One primary action per screen, visually dominant. On `/` that is ticking a sheet row.

## Tokens contract
Token **names and roles** are fixed here; their **values** come from Part B.
- Colour roles: `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--positive`, `--warning`, `--negative`, `--focus`, plus chart roles `--series-ctl`, `--series-atl`, `--series-tsb`, `--block-fill`, `--chart-mark`, the five form-zone roles `--zone-risk`, `--zone-optimal`, `--zone-grey`, `--zone-fresh`, `--zone-transition`, and Part B's `--track`, `--slab`, `--on-slab`, `--on-slab-muted`, `--slab-mark`, `--shadow-card`. (`--focus` and the zone roles replace the placeholder's accent-as-focus and the per-zone tones in `dashboard-view.ts`.)
- Every theme the direction ships (light, dark, or one only) meets the accessibility rules below.
- Spacing: 4-point scale – 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: one value per role (control, card, pill), no exceptions.
- Type: one scale, named by px (`text-12 … text-56`, set by Part B). Tabular numerals for every number that is compared or read mid-set. Glance sizes for `/` are in "Today" below.
- Semantic colours carry meaning only with a label, icon or shape – never colour alone.
- Tokens only: no magic values in components. Tailwind's default colour, text-size and radius scales stay removed.

## Layout
- Max content width 720px on desktop; single column on mobile.
- Hero block at top of `/load`: key figure + one-line status. Everything else below.
- Sticky header only if there is navigation; otherwise none (overridden for `ScreenNav`, see "Today").

## Components (minimum set)
- `KeyFigure` – label, value, delta (with direction), status colour.
- `Card` – title, optional action, content slot.
- `TrendChart` – one series or a few, responsive, axis labels readable at 390px, tooltip on tap/hover, empty state built in.
- `StatusBadge` – text + semantic colour.
- `EmptyState` – icon, one sentence, optional action.
- `ErrorState` – what failed, when, retry.
- `ScreenNav` – tab strip (three links: I dag · Belastning · Analyse) in the root layout; current tab = `aria-current="page"`, marked by weight **and** a bar or fill, never colour alone.

## Interaction
- Touch targets ≥ 44×44px. Tap, not hover, for anything essential.
- Feedback < 100ms. Progress shown for anything > 1s.
- Keyboard: every interactive element focusable, visible focus ring, logical tab order.
- Loading: skeleton in the exact shape of the content, never a spinner in a card.
- Data freshness: show "updated <time>" wherever data comes from a job; mark stale (> expected interval) in `--warning` with text and an icon.
- Undo over confirm: tapping a ticked row again unticks it.

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
- **Screens:** three routes linked by `ScreenNav` ("I dag" · "Belastning" · "Analyse"). All UI copy is Danish; the exact strings live in `design/specs/today.md` §5a, `design/specs/load.md` §4 and §6, `design/specs/analyse.md` §6 and `design/specs/analyse-styrke.md` §4–6.
  - `/` **Today / I dag** answers "What am I doing in this session, and how hard?" (spec `design/specs/today.md`, rules in "Today" below).
  - `/load` **Training load / Belastning** answers "How loaded am I right now, and is fitness going up?". The bullets below, from "Key figure" to "Data", describe `/load`.
  - `/analyse` **Analyse** answers "Am I getting fitter?" in two sections, which are link tabs (`Cykel` · `Styrke`, `aria-current`, no tab roles, no Samlet placeholder) under the shared h1:
    - `/analyse` **Cykel** ("on the bike?", spec `design/specs/analyse.md`): the hero is the eFTP figure, and `--slab` marks the latest eFTP point and the current week.
    - `/analyse/styrke` **Styrke** ("in the three main lifts?", spec `design/specs/analyse-styrke.md`): the hero is the lift board, the block-best e1RM per lift. `--slab` marks only the current week's tonnage bars. e1RM provenance is ink for logged RPE and faded for prescribed RPE, and is always named in words. The sheet's 1RM is labelled `1RM i arket (ikke testet)` and is a reference only.
    - Both follow the data-dashboard pack. Each section shows its own `UpdatedLine` under the tabs.
- **Pattern packs:**
  - `/load` follows [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md). Conflict: the pack rounds kg to 1 decimal, but this app shows kg as logged (up to 2 decimals), because the user compares against their own sheet. DESIGN.md wins.
  - `/` Today is not a dashboard, so the pack's "key figure is the largest element" does not apply there: the session's prescription numbers are. Its data-honesty rules do apply: freshness, gaps never shown as zeros, whole watts.
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
- Days are a list of rows, not a table: native `<details>/<summary>` (keyboard and screen reader without JS), a 16px chevron that rotates without transition. Rest days (no ride and no strength activity) are a plain row reading "Hvile". Strength sits on its matched activity's date; planned-but-undone sessions are not shown (spec `design/specs/today.md` §8). Column heads are visual only; each row speaks "cykling N TSS, …".
- Row grid: day + three 64px TSS columns when the list is ≥ 20rem wide (Tailwind `@xs` container query, so it tracks text size); narrower, e.g. at 200% text, the day moves above the numbers instead of scrolling sideways.
- Missing values show "–", spoken as "ikke registreret". A blank kg on a weighted exercise reads "intet kg logget", never "0 kg". Score/set is labelled as the raw score before the strength factor.

### Today (`/`, added by design-lead; full spec `design/specs/today.md`)
- **Use:** a companion screen, read at arm's length (≈ 60–80 cm) in the gym or from the handlebar. The session is the hero. Form (TSB) is the compact zone bar in the header (Part B), not a key figure.
- **Data:** read-only and server-side. It uses the latest `daily_load` row for the form line, the next undone strength session of the ISO week (session k + 1 of N; the n-th strength activity of the week is session n, and undone sessions have no date), and `planned_sessions` for rides. Python computes every number, including target watts. "Today" is the Europe/Copenhagen date at request time.
- **Glance sizes** (Part B scale):
  - text-32 Barlow Condensed 700 tabular: anything read mid-set or mid-interval, i.e. sets × reps, prescribed load, target watts.
  - text-20: exercise names, the last-week reference, step labels and durations.
  - text-16 / 14 muted: supporting lines.
  - Nothing in a session card is smaller than 14px.
- **As written:** sheet strings (name, sets, reps, prescribed load) are shown verbatim, e.g. "8 - 12", "RPE 6 - 7", "-10%". Only screen-reader text rewrites " - " to " to ". Python-computed numbers (watts, % FTP, durations) use the shared formatters: whole W, en-dash ranges.
- **Tick rows:**
  - Each sheet row is a `<label>` wrapping a native checkbox, and the whole row is the target.
  - The check is a 28px circle, left of the text: a `--text-muted` ring, or filled `--slab` with a `--slab-mark` ✓ when ticked (Part B). The ✓ shape carries the meaning, not only colour.
  - Ticked text turns `--text-muted`; a run's name only once the whole run is ticked. No strike-through, no reordering, rows never move. The only motion is Part B's 120ms press and 180ms colour hand-over, off under reduced motion.
  - Retries ("Prøv igen") are in-app navigations, so ticks survive them; only a browser reload clears ticks.
  - The focus ring surrounds the whole row.
  - Consecutive rows with the same name show the name once, except the NÆSTE row (Part B). Dividers go between runs only.
- **Tick state:**
  - In memory only (client provider in the root layout). It survives in-app navigation and clears on reload.
  - No storage and no requests.
  - One footnote says so: "Flueben forsvinder, når siden genindlæses. Log kg i arket."
- **Ride steps:**
  - Left column: label and duration.
  - Right column: watts in text-32, unit included ("238 W": a smaller capital W reads as "w"), % FTP below it in muted text.
  - Repeat groups get a "Gentag N gange" header, with their steps indented 16px behind a 2px `--chart-mark` rule.
- **Order:** ride card(s), then the strength card, then the rest card (only when no ride today and no strength session left this week). Rest wording never depends on strength dates.
- **Freshness:**
  - The same "updated" line as `/load`. The stale sentence names the consequence: "Form og styrkeprogrammet kan være forældet."
  - A failed plan read is an ErrorState, never a rest day.
- **Nav:** `ScreenNav` is a two-tab strip ("I dag" · "Belastning") at the top of both screens. **Not sticky**, which overrides "Sticky header only if there is navigation": in the gym the 44px goes to the session, and the nav is used rarely.

---

# Part B – Direction: Spurt (chosen 2026-09-30)

**Decision:** base **Spurt** (type, light palette, shape, density, motion, the NÆSTE slab, the segmented progress bar) + **Logbog's zone bar** as the one form element on both screens, restyled in Spurt's language + **dark theme derived from Ro's palette**. The Mode 0 samples (Ro, Logbog, Spurt) are local HTML files, git-ignored; this part is the contract, not the samples.

## Personality
**Energetic, bold, decisive.** Ink, warm grey and one volt accent; big condensed italic headings; prescriptions you can read at 70cm with sweaty hands. `/load` uses the same type and tokens but stays calm: no volt in the chart, card titles in text face.

**The one idea:** `--slab` means **"you are here"**. It fills the NÆSTE row, the zone-bar flag and marker, ticked checks and done progress segments, and nothing else. In light it is ink, in dark it is volt.

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
| `--slab` | `#121212` | `#d4ff3a` | "you are here" fill: NÆSTE row, zone flag + marker, ticked check, done segments |
| `--on-slab` | `#ffffff` | `#121212` | text on slab: 18.7 / 16.2:1 |
| `--on-slab-muted` | `#bdbdbd` | `#3d4a0f` | secondary text on slab: 10.0 / 8.3:1 |
| `--slab-mark` | `#d4ff3a` | `#121212` | ✓ in a ticked check, the check ring on the NÆSTE row, the NÆSTE tag fill: 16.2:1 against `--slab` |
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
| `--chart-height` | 224px below 640px, 240px from 640px | same | keeps hero + chart above the fold at 390 × 844 (load.md §9a) |

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
| `text-56` | 56 / 1.0 | Condensed 800 italic, tabular | the `/load` zone-flag value. The largest element on `/load` (Part A principle 4) |
| `text-44` | 44 / 1.0 | Condensed 800 italic, uppercase, −0.01em | page title: "I DAG", "BELASTNING". Date after it in `text-16` Barlow 500 `--text-muted`, sentence case |
| `text-32` | 32 / 1.1 | Condensed 700 upright, tabular | **prescriptions**: sets × reps, prescribed load, target watts ("238 W", W the same size) |
| `text-32` | 32 / 1.0 | Condensed 800 italic, uppercase | session-card titles on `/` ("STYRKE", "CYKEL"). On `/load` card titles are `text-20` Barlow 700, sentence case (calm) |
| `text-24` | 24 / 1.0 | Condensed 800 italic, tabular | Today's zone-flag value; the done count in "**2** af 8 udført" |
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
- Page gutter 12px (content 366px at 390). Max width 720px, single column at every width.
- Header: nav 12px from the top; the title 16px below the nav; "Opdateret …" 4px under the title; the zone bar 12px under that.
- `main` stack gap 16px, bottom padding 48px.
- Card padding 24px top, 16px sides and bottom. Inside a card: progress bar 12px under the head, done list 16px, session line 12px, list 12px.
- Tick row: min-height 44px, padding 8px 4px, grid `28px 1fr` with a 12px gap; the check aligns to the prescription line (bottom, 4px up).
- `/load` keeps its week-card layout (Part A) with these tokens.

## Motion
Snappy, short, and only on things you touched. Easing `ease-out`.
- **Press:** a check scales to 0.9 on `:active` and fills in 120ms.
- **Hand-over:** when a row is ticked, the slab colour cross-fades off that row and onto the next unticked row in 180ms. Colour only: rows never move or reorder.
- **Progress:** the next segment fills in 120ms.
- **Never animated:** numbers, the zone marker (no slide on load or update), the chart, page transitions.
- **Reduced motion:** under `prefers-reduced-motion: reduce` every transition is 0ms and the press scale is off. The end state is the still alternative. Skeletons pulse only under `motion-safe`.

## Signature components

### NÆSTE slab (Today, strength card)
- The **first unticked row** in the session (document order) becomes the slab. No slab when every row is ticked.
- It is filled `--slab` with `--on-slab` text. Prescriptions are also `--on-slab` (not muted). The check ring is 3px `--slab-mark`.
- It bleeds 8px past the row on both sides (margin-inline −8px, padding 12px), with 8px margin-block and `rounded-control`.
- The name line **always shows the exercise name**, even inside a run (override). The **NÆSTE** tag sits right-aligned on the same line: `text-14` 700 uppercase +0.08em, `--slab-mark` fill, `--slab` text, padding 2px 8px, `rounded-mark`.
- The tag is part of the label text, so screen readers hear "Næste" too.
- Focus: a 3px `--focus` outline with 3px offset around the whole row.

### Segmented progress (Today, strength card head)
- The head reads "**2** af 8 udført": the count in `text-24` display, the rest in `text-16` 600.
- Under it, one segment per sheet row of the session (8 in the sample): 8px high, 4px gaps, `rounded-mark`.
- The first *k* segments are `--slab`, where *k* is the ticked count (not the ticked positions). The rest are `--track`.
- `aria-hidden`: the text carries the count.

### Zone bar (form: Today header, `/load` hero)
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

| | Compact (Today header) | Hero (`/load`) |
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
