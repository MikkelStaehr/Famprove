# Pattern pack – Data dashboard

Use for products whose main job is to show numbers, trends and status (e.g. training data, production KPIs, OEE, cashflow). Adds to DESIGN.md. It does not replace it.

## Principles
- **Answer first.** The screen's key figure is the largest element. Charts support it, never replace it.
- **Max 3 things above the fold** at 390px: key figure + status, one chart, one secondary block.
- **Compare, don't just display.** Every number has a reference: a delta vs. the previous period, a target, or a normal range.

## Layout
- **Hero block** at the top: key figure, delta with direction, a one-line status in plain words ("Fresh – ready for hard session").
- Detail cards below, ordered by how often they are used, not by data source.
- Hero number type size: 40, line-height 1.1, tabular numerals (`font-variant-numeric: tabular-nums`).

## Components
- `KeyFigure`: label, value + unit, delta (arrow + sign + text, never colour alone), status colour.
- `TrendChart`: 1–3 series, readable axis labels at 390px, tap/hover tooltip, built-in empty state, units on the axis or in the title.
- `DataTable` (if needed): right-aligned numbers, tabular numerals, sticky header, horizontal scroll inside its container on mobile.

## Data honesty
- Show "updated <time>" wherever data comes from a job or sync. If it is older than the expected interval, mark it stale in `--warning` with text.
- Missing data is shown as a gap, never interpolated to zero.
- Axes start at zero for bars. Line charts may zoom, but only with a visible axis.
- Round to the precision that matters (1 decimal for kg, whole numbers for watts).

## Charts
- Every chart has units, a title that states the insight, and a text alternative (a sentence with the key values, or a table).
- Max 3 colours per chart. Series are distinguishable without colour (labels, dash, markers).
- No pie charts with more than 3 slices. No 3D. No dual y-axes unless unavoidable, and if so, label them clearly.

## Don'ts
- No dashboards with 8 equal widgets.
- No number without a unit or a reference.
- No chart where a single number would do.
