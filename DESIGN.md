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
- **Question:** "How loaded am I right now, and is fitness going up?" — one screen, no other routes.
- **Key figure (hero):** TSB today (form = CTL − ATL) from the latest `daily_load` row, with a one-line status.
- **Chart:** CTL, ATL and TSB per day since 2026-01-01. Strength blocks shaded (`blocks.start_date` → `end_date`, an ongoing block runs to today); deload weeks marked (`blocks.deload_start` → `end_date`).
- **Secondary:** this week's sessions (ISO week, Mon–Sun) — cycling TSS and strength TSS per day, plus the week total from `weekly_load`.
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
