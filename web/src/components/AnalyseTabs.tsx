import Link from "next/link";

import type { Freshness } from "@/lib/dashboard-view";
import { formatUpdatedAt } from "@/lib/format";

import { UpdatedLine } from "./UpdatedLine";

const SECTIONS = [
  { key: "cykel", href: "/analyse", label: "Cykel" },
  { key: "styrke", href: "/analyse/styrke", label: "Styrke" },
] as const;

export type AnalyseSection = (typeof SECTIONS)[number]["key"];

/**
 * Section tabs (reset-analyse-cykel.md §2.2): a full-width SegmentedControl look over two links
 * with aria-current, no tab roles. Track --bg, 1px --border, radius 10, padding 3; segments radius 7,
 * 38px tall (44px total hit with the track), Geist 14. Current = --raised fill + --text 500, the
 * other --text-muted 400: fill and weight, never colour alone.
 */
export function AnalyseTabs({ current }: { readonly current: AnalyseSection }) {
  return (
    <nav aria-label="Sektioner" className="w-full lg:max-w-90">
      <ul className="grid grid-cols-2 gap-0.5 rounded-control border border-border bg-bg p-0.75">
        {SECTIONS.map((s) => {
          const isCurrent = s.key === current;
          return (
            <li key={s.key} className="flex">
              <Link
                href={s.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`inline-flex h-9.5 w-full items-center justify-center rounded-segment font-sans text-14 transition-colors duration-[120ms] ease-out ${
                  isCurrent ? "bg-raised font-medium text-text" : "font-normal text-text-muted hover:text-text"
                }`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The section's header block under the shared h1 (reset-analyse-cykel.md §2.1–2.2): the updated
 * line as a MonoCaption 12 (`opdateret …`), stale or unknown as the shared WarningLine (icon +
 * words, never colour alone), then the section tabs and the sr-only section h2.
 */
export function AnalyseHeader({
  current,
  freshness,
}: {
  readonly current: AnalyseSection;
  /** null while loading or without data: no line. */
  readonly freshness: Freshness | null;
}) {
  return (
    <div className="-mt-1 flex flex-col gap-3 lg:col-span-3">
      {freshness === null ? null : freshness.kind === "fresh" ? (
        <p className="px-1 font-mono text-12 text-text-muted">
          opdateret <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>
        </p>
      ) : (
        <div className="px-1">
          <UpdatedLine
            freshness={freshness}
            staleNote="Jobbet skal køre dagligt omkring kl. 05.00."
            unknownNote="Opdateringstidspunkt ukendt, så data kan være forældet."
          />
        </div>
      )}
      <AnalyseTabs current={current} />
      <h2 className="sr-only">{current === "cykel" ? "Cykel" : "Styrke"}</h2>
    </div>
  );
}

/** A loading placeholder for the updated line (MonoCaption height). */
export function AnalyseHeaderSkeleton({ current }: { readonly current: AnalyseSection }) {
  return (
    <div className="-mt-1 flex flex-col gap-3 lg:col-span-3">
      <span aria-hidden="true" className="mx-1 block h-4 w-1/3 rounded-cell bg-raised motion-safe:animate-pulse" />
      <AnalyseTabs current={current} />
      <h2 className="sr-only">{current === "cykel" ? "Cykel" : "Styrke"}</h2>
    </div>
  );
}
