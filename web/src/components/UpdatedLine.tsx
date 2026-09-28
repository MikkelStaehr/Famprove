import type { Freshness } from "@/lib/dashboard-view";
import { formatUpdatedAt } from "@/lib/format";

import { WarningLine } from "./WarningLine";

type UpdatedLineProps = {
  readonly freshness: Freshness;
  /** Stale: the sentence after "Stale: last updated <time>." It names the consequence. */
  readonly staleNote: string;
  /** Unknown computed_at: the whole sentence. */
  readonly unknownNote: string;
};

/** "Updated <time>"; stale or unknown in --warning with an icon and words, never colour alone. */
export function UpdatedLine({ freshness, staleNote, unknownNote }: UpdatedLineProps) {
  if (freshness.kind === "fresh") {
    return (
      <p className="text-14 text-text-muted">
        Updated <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>
      </p>
    );
  }
  return (
    <WarningLine>
      {freshness.kind === "stale" ? (
        <>
          Stale: last updated{" "}
          <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>.{" "}
          {staleNote}
        </>
      ) : (
        unknownNote
      )}
    </WarningLine>
  );
}
