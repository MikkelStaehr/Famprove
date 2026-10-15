import type { Freshness } from "@/lib/dashboard-view";
import { updatedText } from "@/lib/format";

import { RefreshButton, WithRefresh } from "./Refresh";

import { WarningLine } from "./WarningLine";

type UpdatedLineProps = {
  readonly freshness: Freshness;
  /** Stale: the sentence after "Forældet: sidst opdateret <time>." It names the consequence. */
  readonly staleNote: string;
  /** Unknown computed_at: the whole sentence. */
  readonly unknownNote: string;
};

/** "opdateret <time>↻" (refresh.md §1: the time and the ↻ never wrap apart); the caller's line styles it. */
export function UpdatedTime({ computedAt }: { readonly computedAt: string }) {
  return (
    <>
      opdateret{" "}
      <span className="whitespace-nowrap">
        <time dateTime={computedAt}>{updatedText(computedAt, null).sentence}</time>
        <RefreshButton attention={false} />
      </span>
    </>
  );
}

/**
 * "opdateret <time>" in Geist Mono 12 muted; stale or unknown = ◆ + words in --text (WarningLine),
 * never colour alone. Each ends with the ↻ (refresh.md §1), so it needs a RefreshProvider above it.
 */
export function UpdatedLine({ freshness, staleNote, unknownNote }: UpdatedLineProps) {
  if (freshness.kind === "fresh") {
    return (
      <p className="font-mono text-12 text-text-muted">
        <UpdatedTime computedAt={freshness.computedAt} />
      </p>
    );
  }
  return (
    <WarningLine>
      {freshness.kind === "stale" ? (
        <>
          Forældet: sidst opdateret{" "}
          <time dateTime={freshness.computedAt}>{updatedText(freshness.computedAt, null).sentence}</time>.{" "}
          <WithRefresh text={staleNote} attention />
        </>
      ) : (
        <WithRefresh text={unknownNote} attention />
      )}
    </WarningLine>
  );
}
