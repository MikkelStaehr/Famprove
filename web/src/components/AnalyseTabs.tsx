import Link from "next/link";

const SECTIONS = [
  { key: "cykel", href: "/analyse", label: "Cykel" },
  { key: "styrke", href: "/analyse/styrke", label: "Styrke" },
] as const;

export type AnalyseSection = (typeof SECTIONS)[number]["key"];

/**
 * DESIGN.md "Section tabs" (analyse-styrke.md §2): the section word is the tab. Plain links with
 * aria-current, no role="tab", no client state. Current = weight 800 + a 4px --text bar + --text,
 * never colour alone; never ScreenNav's pill track, never --slab.
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
                className={`inline-flex min-h-11 flex-col items-stretch rounded-control pt-1 font-display text-32 leading-none uppercase italic focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus ${
                  isCurrent ? "font-extrabold text-text" : "font-bold text-text-muted hover:text-text"
                }`}
              >
                {s.label}
                <span
                  aria-hidden="true"
                  className={`mt-1 block h-1 rounded-mark ${isCurrent ? "bg-text" : "bg-transparent"}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
