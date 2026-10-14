import { type SetRef, setKey, type SetState } from "@/lib/set-taps";

/**
 * Progress strip (reset-fokus.md §5): one segment per set in sheet order, equal height, 2px gaps,
 * radius 2, on a --border baseline. Done --text, skipped --shade-2, open --track, the current set
 * a 1px --text outline (none when finished). aria-hidden: the count text carries it.
 */
export function FokusProgress({
  order,
  stateOf,
  current,
}: {
  readonly order: readonly SetRef[];
  readonly stateOf: (ref: SetRef) => SetState;
  readonly current: SetRef | null;
}) {
  const now = current === null ? null : setKey(current);
  return (
    <div aria-hidden="true" className="flex h-6 items-end gap-0.5 border-b border-border pb-1">
      {order.map((ref) => {
        const key = setKey(ref);
        const state = stateOf(ref);
        const fill = state === "done" ? "bg-text" : state === "skipped" ? "bg-shade-2" : "bg-track";
        const ring = key === now ? " outline-1 -outline-offset-1 outline-text" : "";
        return (
          <span key={key} data-state={key === now ? "current" : state} className={`block h-2 min-w-0 flex-1 rounded-[2px] ${fill}${ring}`} />
        );
      })}
    </div>
  );
}
