"use client";

import { ErrorState } from "@/components/ErrorState";

/**
 * A tab slot's error boundary (docs/decisions/tab-shell.md §7): an unexpected failure in one tab
 * stays in that tab; the shell and the other two keep working. Data errors the tabs expect are
 * shown inside them (their own ErrorState); this catches the rest. `retry` re-fetches and re-renders the slot (Next 16 error.js).
 */
export function TabError({ tab, retry }: { readonly tab: string; readonly retry: () => void }) {
  return (
    <div className="pt-6">
      <ErrorState title={`${tab} kunne ikke vises`} what="Noget gik galt, mens siden blev bygget." retry={{ onRetry: retry }} />
    </div>
  );
}
