import { type SetRef, setKey, type SetState } from "@/lib/set-taps";

/**
 * Progress barcode (DESIGN.md Part B signature 2, fokus-instrument.md §1): one tick per set in
 * sheet order, bottom-aligned on a hairline. Done 2×16px ink, skipped 2×6px muted, open 1×6px
 * muted, the current set 2×24px --accent (none when finished). Shape carries state; aria-hidden:
 * the count text carries it.
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
    <div aria-hidden="true" className="flex h-6 items-end justify-between border-b border-border">
      {order.map((ref) => {
        const key = setKey(ref);
        const state = stateOf(ref);
        const tick =
          key === now
            ? "h-6 w-0.5 bg-accent"
            : state === "done"
              ? "h-4 w-0.5 bg-text"
              : state === "skipped"
                ? "h-1.5 w-0.5 bg-text-muted"
                : "h-1.5 w-px bg-text-muted";
        return <span key={key} data-state={key === now ? "current" : state} className={`block shrink-0 ${tick}`} />;
      })}
    </div>
  );
}
