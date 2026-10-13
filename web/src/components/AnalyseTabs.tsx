import Link from "next/link";

const SECTIONS = [
  { key: "cykel", href: "/analyse", label: "Cykel" },
  { key: "styrke", href: "/analyse/styrke", label: "Styrke" },
] as const;

export type AnalyseSection = (typeof SECTIONS)[number]["key"];

/**
 * DESIGN.md "Section tabs" (instrument-analyse.md §1): the section word is the tab, Inter 400
 * text-24. Current = --text 500 + a 2px --text underline (offset 6px), the other --text-muted 400:
 * weight and the rule carry it, never colour alone. Plain links with aria-current, no role="tab".
 */
export function AnalyseTabs({ current }: { readonly current: AnalyseSection }) {
  return (
    <nav aria-label="Sektioner">
      <ul className="flex flex-wrap gap-x-6">
        {SECTIONS.map((s) => {
          const isCurrent = s.key === current;
          return (
            <li key={s.key} className="flex">
              <Link
                href={s.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`inline-flex min-h-11 items-center font-sans text-24 underline-offset-[6px] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus ${
                  isCurrent ? "font-medium text-text underline decoration-2" : "font-normal text-text-muted no-underline hover:text-text"
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
