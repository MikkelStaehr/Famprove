"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Træning" },
  { href: "/load", label: "Belastning" },
  { href: "/analyse", label: "Analyse" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * DESIGN.md ScreenNav (Part B): a --track pill with three tabs, not sticky. The current tab has
 * aria-current="page", a --text fill with --bg text and weight 700: fill and weight, never
 * colour alone (and deliberately not --slab). It renders its own <header> and nothing at all on
 * /fokus (a full-screen mode whose only exit is Afslut, spec traening.md §2).
 */
export function ScreenNav() {
  const pathname = usePathname();
  if (pathname === "/fokus" || pathname.startsWith("/fokus/")) return null;
  return (
    <header className="mx-auto w-full max-w-content px-3 pt-3 pb-1">
      {/* @container: below 3 × 6.5rem + gaps + padding (20.5rem) the tabs wrap, and a pill track
          would become a blob, so the wrapped track takes rounded-card (spec traening.md, 200% text). */}
      <nav aria-label="Hovedmenu" className="@container">
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-1 rounded-pill bg-track p-1 @max-[20.5rem]:rounded-card">
        {TABS.map((tab) => {
          const current = isCurrent(pathname, tab.href);
          return (
            <li key={tab.href} className="flex">
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-pill px-3 text-16 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus ${
                  current ? "bg-text font-bold text-bg" : "font-semibold text-text"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
      </nav>
    </header>
  );
}
