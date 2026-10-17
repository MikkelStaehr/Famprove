import type { Ref } from "react";

import { Icon } from "@/components/icons";
import type { BarGroup, SheetDot } from "@/lib/fokus-view";
import { setKey } from "@/lib/set-taps";

const FILL: Record<SheetDot, string> = {
  done: "bg-text",
  skipped: "bg-shade-2",
  now: "bg-track outline-1 -outline-offset-1 outline-text",
  upcoming: "bg-track",
};

/**
 * The grouped progress bar (fokus-sheet.md §"The grouped bar"): one group per exercise run (a
 * superset pair one group, interleaved, with a bracket under it), 2px between sets and 6px between
 * groups (1px / 4px above 30 sets), each group as wide as its set count. Segments as reset-fokus.md
 * §5. Drawn only (aria-hidden); the count carries it.
 */
export function GroupedBar({ groups }: { readonly groups: readonly BarGroup[] }) {
  const sets = groups.reduce((n, g) => n + g.segments.length, 0);
  const dense = sets > 30;
  return (
    <span aria-hidden="true" className={`flex h-6 items-end border-b border-border pb-1 ${dense ? "gap-1" : "gap-1.5"}`}>
      {groups.map((g) => (
        <span
          key={g.runs.join("+")}
          data-group={g.pair ? "pair" : "run"}
          className={`relative flex min-w-0 items-end ${dense ? "gap-px" : "gap-0.5"}`}
          style={{ flex: g.segments.length }}
        >
          {g.segments.map((s) => (
            <span key={setKey(s.ref)} data-state={s.state === "now" ? "current" : s.state} className={`block h-2 min-w-0 flex-1 rounded-[2px] ${FILL[s.state]}`} />
          ))}
          {/* §3: the strength-block bracket in small, 3px under the pair. */}
          {g.pair && (
            <span className="absolute inset-x-0 top-[calc(100%+3px)] h-1.5 border-x-[1.5px] border-t-[1.5px] border-text-muted" />
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * §4: the count and the bar as one button (≥ 44px, to 8px under the bar) with a ChevronDown, which
 * opens the session sheet. Afslut and Fortryd stay outside it.
 */
export function ProgressButton({
  groups,
  done,
  total,
  skipped,
  expanded,
  onOpen,
  buttonRef,
  locked = false,
}: {
  /** video-record.md §7: while recording the bar is not a button (no chevron), so no jump moves the set. */
  readonly locked?: boolean;
  readonly groups: readonly BarGroup[];
  readonly done: number;
  readonly total: number;
  /** fokusView's spoken skip tail (", 1 sprunget over") or null. */
  readonly skipped: string | null;
  readonly expanded: boolean;
  readonly onOpen: () => void;
  readonly buttonRef: Ref<HTMLButtonElement>;
}) {
  if (locked) {
    return (
      <div className="mt-2 flex min-h-11 w-full items-end gap-3 pb-2 text-text">
        <span className="sr-only">
          {done} af {total} sæt udført{skipped}
        </span>
        <span className="min-w-0 flex-1">
          <GroupedBar groups={groups} />
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1 font-mono text-16 leading-none font-medium tabular-nums">
          {done}/{total}
        </span>
      </div>
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="mt-2 flex min-h-11 w-full items-end gap-3 rounded-[4px] pb-2 text-left text-text active:opacity-85"
    >
      <span className="sr-only">
        Vis hele sessionen, {done} af {total} sæt udført{skipped}
      </span>
      <span className="min-w-0 flex-1">
        <GroupedBar groups={groups} />
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1 font-mono text-16 leading-none font-medium tabular-nums">
        {done}/{total}
        <Icon name="chevron-down" size={16} className="text-text-muted" />
      </span>
    </button>
  );
}
