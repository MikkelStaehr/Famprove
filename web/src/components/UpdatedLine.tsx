import type { Freshness } from "@/lib/dashboard-view";
import { formatUpdatedAt } from "@/lib/format";

import { WarningLine } from "./WarningLine";

type UpdatedLineProps = {
  readonly freshness: Freshness;
  /** Stale: the sentence after "Forældet: sidst opdateret <time>." It names the consequence. */
  readonly staleNote: string;
  /** Unknown computed_at: the whole sentence. */
  readonly unknownNote: string;
};

/** "Opdateret <time>" in Inter 14 muted; stale or unknown = ◆ + words in --text (WarningLine), never colour alone. */
export function UpdatedLine({ freshness, staleNote, unknownNote }: UpdatedLineProps) {
  if (freshness.kind === "fresh") {
    return (
      <p className="font-sans text-14 text-text-muted">
        Opdateret <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>
      </p>
    );
  }
  return (
    <WarningLine>
      {freshness.kind === "stale" ? (
        <>
          Forældet: sidst opdateret{" "}
          <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>.{" "}
          {staleNote}
        </>
      ) : (
        unknownNote
      )}
    </WarningLine>
  );
}
