import { type SetRef, setKey, type SetState } from "@/lib/set-taps";

/**
 * Segmented progress (DESIGN.md Part B), one segment per set by position: done --slab, skipped
 * --track with a 2px --text-muted bar (shape, not colour), open --track. 8px high; 4px gaps, 2px
 * above 30 sets. aria-hidden: the count text carries it.
 */
export function FokusProgress({
  order,
  stateOf,
}: {
  readonly order: readonly SetRef[];
  readonly stateOf: (ref: SetRef) => SetState;
}) {
  return (
    <div aria-hidden="true" className={`flex ${order.length > 30 ? "gap-0.5" : "gap-1"}`}>
      {order.map((ref) => {
        const state = stateOf(ref);
        return (
          <span
            key={setKey(ref)}
            className={`relative h-2 flex-1 rounded-mark transition-colors duration-120 ease-out motion-reduce:transition-none ${
              state === "done" ? "bg-slab" : "bg-track"
            }`}
          >
            {state === "skipped" && (
              <span className="absolute inset-x-1/4 top-1/2 h-0.5 -translate-y-1/2 bg-text-muted" />
            )}
          </span>
        );
      })}
    </div>
  );
}
