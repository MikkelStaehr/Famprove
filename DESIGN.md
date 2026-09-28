# Design system – training-app

Read by the `ui` agent before any UI work. Project-specific overrides go at the bottom.

## Principles
1. One screen answers one question. If the user needs to scroll to find the answer, the layout is wrong.
2. Mobile first. Design at 390px, then let it grow. Never the other way round.
3. Show state honestly: loading, empty, error and stale each have their own visible treatment. Never a blank area.
4. Numbers before decoration. The key figure is the largest element on the screen; charts support it, never replace it.
5. Boring is good. System fonts, few colours, no animation unless it explains a change.

## Tokens (CSS variables / Tailwind theme)
- Spacing: 4-point scale – 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: 8 (controls), 12 (cards). One value per role, no exceptions.
- Type: system stack. Sizes 12 / 14 / 16 (body) / 20 / 28 / 40 (hero number). Line-height 1.4 body, 1.1 numbers.
- Colour: `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--positive`, `--warning`, `--negative`. Light and dark defined; contrast ≥ 4.5:1 for text, ≥ 3:1 for large numbers and icons.
- Semantic colours carry meaning only with a label or icon – never colour alone.

## Layout
- Max content width 720px on desktop; single column on mobile.
- Cards: `--surface` on `--bg`, 16px padding, 1px `--border`. No shadows.
- Hero block at top: key figure + one-line status. Everything else below.
- Sticky header only if there is navigation; otherwise none.

## Components (minimum set)
- `KeyFigure` – label, value, delta (with direction), status colour.
- `Card` – title, optional action, content slot.
- `TrendChart` – one series or a few, responsive, axis labels readable at 390px, tooltip on tap/hover, empty state built in.
- `StatusBadge` – text + semantic colour.
- `EmptyState` – icon, one sentence, optional action.
- `ErrorState` – what failed, when, retry.
- `ScreenNav` – two-tab strip in the root layout; current tab = `aria-current="page"`, semibold + 2px bar (see "Today").

## Interaction
- Touch targets ≥ 44×44px. Tap, not hover, for anything essential.
- Keyboard: every interactive element focusable, visible focus ring, logical tab order.
- Loading: skeleton in the exact shape of the content, never a spinner in a card.
- Data freshness: show "updated <time>" wherever data comes from a job; mark stale (> expected interval) in `--warning`.

## Accessibility checklist (run before merge)
- Semantic HTML (`main`, `header`, `nav`, headings in order).
- Charts have a text alternative (a table or a sentence with the key values).
- Colour contrast checked in both themes.
- Text scales to 200% without breaking layout.
- `prefers-reduced-motion` respected.

## Don'ts
- No dashboards with 8 widgets. Max 3 things above the fold.
- No icon-only buttons without `aria-label`.
- No custom fonts loaded from third parties.
- No charts without units.

## Project overrides
- **Screens:** two routes linked by a two-tab `ScreenNav` ("Today" · "Training load").
  - `/` **Today** answers "What am I doing in this session, and how hard?" (spec `design/specs/today.md`, rules in "Today" below).
  - `/load` **Training load** answers "How loaded am I right now, and is fitness going up?". The bullets below, from "Key figure" to "Data", describe `/load`.
- **Pattern packs:**
  - `/load` follows [`design/patterns/data-dashboard.md`](design/patterns/data-dashboard.md). Conflict: the pack rounds kg to 1 decimal, but this app shows kg as logged (up to 2 decimals), because the user compares against their own sheet. DESIGN.md wins.
  - `/` Today is not a dashboard, so the pack's "key figure is the largest element" does not apply there: the session's prescription numbers are. Its data-honesty rules do apply: freshness, gaps never shown as zeros, whole watts.
- **Key figure (hero):** TSB today (form = CTL − ATL) from the latest `daily_load` row, with a one-line status.
- **Chart:** CTL, ATL and TSB per day since 2026-01-01. Strength blocks shaded (`blocks.start_date` → `end_date`, an ongoing block runs to today); deload weeks marked (`blocks.deload_start` → `end_date`).
- **Secondary:** this week's sessions (ISO week, Mon–Sun) — cycling TSS and strength TSS per day, plus the week total from `weekly_load`. A week switcher (`?week=2026-W33`, previous / next ISO week, "Back to this week") looks back; days expand to their rides and strength exercises.
- **Freshness:** "updated <time>" from the latest `daily_load` row; stale when older than 26 h (the job runs daily ≈ 05:00 Europe/Copenhagen).
- **Units:** load in TSS; CTL / ATL / TSB in TSS/day.
- **Data:** read-only, server-side, from `daily_load`, `blocks` and `weekly_load`. The UI never calculates training metrics (Python owns them).

### Token values (added by `ui`, M2)
Defined once in `web/src/app/globals.css` (CSS variables, switched by `prefers-color-scheme`) and exposed to Tailwind via `@theme inline`; Tailwind's default colour, text-size and radius scales are removed so nothing off-token can be used.

| Token | Light | Dark | Reason |
|---|---|---|---|
| `--bg` / `--surface` | `#f5f6f8` / `#ffffff` | `#0f1114` / `#181b20` | page vs card, no shadows |
| `--border` | `#d8dce2` | `#2e333b` | card border, grid lines, skeleton fill |
| `--text` / `--text-muted` | `#15181c` / `#586069` | `#eceef1` / `#a3aab4` | ≥ 5.9:1 on bg and surface |
| `--accent` | `#1f5bd0` | `#7aa7ff` | focus ring, links |
| `--positive` / `--warning` / `--negative` | `#18743a` / `#8a4f00` / `#b42318` | `#5cc98a` / `#f0b44c` / `#ff8a80` | used as text: ≥ 5.4:1 on bg and surface |
| `--series-ctl` / `--series-atl` / `--series-tsb` | `#1f5bd0` / `#c2410c` / `#7c3aed` | `#7aa7ff` / `#f59e5b` / `#b794ff` | the three chart lines; ≥ 4.4:1 on surface and on block shading. Colour is never alone: solid / dashed / dotted strokes |
| `--block-fill` | `#eceff3` | `#242931` | strength-block shading behind the lines |
| `--chart-mark` | `#8b94a1` | `#6b7480` | non-data marks (zero line, deload hatch); ≥ 3:1 on surface |
| `--chart-height` | 240px | 240px | the one chart height; keeps hero + chart above the fold at 390 × 844 |

- Type: Tailwind's default `--font-sans` is already a system stack (no web fonts). Utilities are named by px: `text-12 … text-40`; 12–20 at line-height 1.4, 28/40 at 1.1.
- Radius: `rounded-control` (8) also for badges and the chart tooltip (small, control-like); `rounded-card` (12) for cards.
- Width: `max-w-content` = 720px.
- Deload weeks: diagonal hatch (`--chart-mark` on `--block-fill`), so they differ from block shading by pattern, not only colour. Block labels above the plot read `B<n>` (block number).
- Motion: no chart animation at all (nothing to explain); skeletons pulse only under `motion-safe`.

### Week card (added by `ui`, M2 week detail)
- Title "This week · week N" for the latest week, "Week N" otherwise; the "Back to this week" link sits in the card action.
- Switcher: previous / next are real links (44 × 44, `aria-label` names the target week), absent at the ends (an empty 44px box keeps the label centred). They use `scroll={false}` so switching keeps the scroll position and keyboard focus. Label: date range + ISO week (`2026-W33`).
- Switching weeks re-renders only the day list: a `<Suspense>` keyed by the week shows its skeleton; hero and chart never flash. Detail errors show an ErrorState inside the card.
- Days are a list of rows, not a table: native `<details>/<summary>` (keyboard and screen reader without JS), a 16px chevron that rotates without transition. Rest days are a plain row reading "Rest". Column heads are visual only; each row speaks "cycling N TSS, …".
- Row grid: day + three 64px TSS columns when the list is ≥ 20rem wide (Tailwind `@xs` container query, so it tracks text size); narrower, e.g. at 200% text, the day moves above the numbers instead of scrolling sideways.
- Missing values show "–", spoken as "not recorded". A blank kg on a weighted exercise reads "no kg logged", never "0 kg". Score/set is labelled as the raw score before the strength factor.

### Today (`/`, added by design-lead; full spec `design/specs/today.md`)
- **Use:** a companion screen, read at arm's length (≈ 60–80 cm) in the gym or from the handlebar. The session is the hero. Form (TSB) is one header line, not a key figure.
- **Data:** read-only and server-side. It uses the latest `daily_load` row for the form line, today's strength plan from the sheet data, and `planned_sessions` for rides. Python computes every number, including target watts. "Today" is the Europe/Copenhagen date at request time.
- **Glance sizes** (existing tokens, no new sizes):
  - text-28 bold tabular: anything read mid-set or mid-interval, i.e. sets × reps, prescribed load, target watts.
  - text-20: exercise names, the last-week reference, step labels and durations.
  - text-16 / 14 muted: supporting lines.
  - Nothing in a session card is smaller than 14px.
- **As written:** sheet strings (name, sets, reps, prescribed load) are shown verbatim, e.g. "8 - 12", "RPE 6 - 7", "-10%". Only screen-reader text rewrites " - " to " to ". Python-computed numbers (watts, % FTP, durations) use the shared formatters: whole W, en-dash ranges.
- **Tick rows:**
  - Each sheet row is a `<label>` wrapping a native checkbox, and the whole row is the target.
  - The check is a 28px circle, left of the text: a `--text-muted` ring, or filled `--positive` with a ✓ when ticked. The ✓ shape carries the meaning, not only colour.
  - Ticked text turns `--text-muted`; a run's name only once the whole run is ticked. No strike-through, no reordering, no motion.
  - Retries ("Try again") are in-app navigations, so ticks survive them; only a browser reload clears ticks.
  - The focus ring surrounds the whole row.
  - Consecutive rows with the same name show the name once. Dividers go between runs only.
- **Tick state:**
  - In memory only (client provider in the root layout). It survives in-app navigation and clears on reload.
  - No storage and no requests.
  - One footnote says so: "Ticks clear when the page reloads. Log kg in the sheet."
- **Ride steps:**
  - Left column: label and duration.
  - Right column: watts in text-28, unit included ("238 W": a smaller capital W reads as "w"), % FTP below it in muted text.
  - Repeat groups get a "Repeat N times" header, with their steps indented 16px behind a 2px `--chart-mark` rule.
- **Order:** ride card(s), then the strength card, then (only when neither) the rest card.
- **Freshness:**
  - The same "updated" line as `/load`. The stale sentence names the consequence: "Form and the strength plan may be out of date."
  - A failed plan read is an ErrorState, never a rest day.
- **Nav:** `ScreenNav` is a two-tab strip ("Today" · "Training load") at the top of both screens. **Not sticky**, which overrides "Sticky header only if there is navigation": in the gym the 44px goes to the session, and the nav is used rarely.
