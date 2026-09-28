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
