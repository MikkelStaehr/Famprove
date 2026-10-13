import type { SetState } from "@/lib/set-taps";
import { type ColumnTone, type WeekColumn, weekColumnsGeometry } from "@/lib/training-view";

const TONE: Readonly<Record<ColumnTone, string>> = {
  text: "var(--text)",
  muted: "var(--text-muted)",
  border: "var(--border)",
};

/**
 * The week's sessions as short columns (instrument-traening.md §2.2): one 8px column per session,
 * one 8 × 1 tick per set, bottom up. Done sessions ink; the current one ink where done or
 * skipped, muted where open, with the red today tick under it (the page's only --accent); later
 * sessions --border ticks inside a 1px --text-muted outline. aria-hidden: the caller renders
 * weekSentence as sr text. No motion.
 */
export function WeekColumns({
  columns,
  current,
  className = "",
}: {
  readonly columns: readonly WeekColumn[];
  readonly current: readonly SetState[] | null;
  readonly className?: string;
}) {
  if (columns.length === 0) return null;
  const g = weekColumnsGeometry(columns, current);
  return (
    <svg
      aria-hidden="true"
      data-testid="week-columns"
      width={g.width}
      height={g.height}
      viewBox={`0 0 ${g.width} ${g.height}`}
      className={`block shrink-0 overflow-visible ${className}`}
    >
      {g.columns.map((c) => (
        <g key={c.session} data-session={c.session}>
          {c.ticks.map((t, i) => (
            <rect key={i} x={c.x} y={t.y} width={g.columnWidth} height={1} fill={TONE[t.tone]} />
          ))}
          {c.outline && c.ticks.length > 0 && (
            <rect
              x={c.x + 0.5}
              y={c.top + 0.5}
              width={g.columnWidth - 1}
              height={g.baseline - c.top - 1}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1}
            />
          )}
          {c.today && (
            <rect
              data-today="true"
              x={c.x}
              y={g.todayTick.y}
              width={g.columnWidth}
              height={g.todayTick.height}
              fill="var(--accent)"
            />
          )}
        </g>
      ))}
    </svg>
  );
}
