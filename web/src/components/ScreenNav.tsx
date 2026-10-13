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
 * DESIGN.md ScreenNav (Part A "Layout: phone and desktop", Part B look): a --track pill with three
 * tabs. Below lg a fixed bottom bar (--bg, 1px --border hairline, --bottom-bar high); from lg a
 * static top bar in the frame, the pill auto-width and left-aligned. The <header> stays in flow
 * before <main> at every width, so keyboard users meet the nav first; only its position changes.
 * The current tab has aria-current="page", a --text fill with --bg text and weight 700: fill and
 * weight, never colour alone (and deliberately not --slab). Nothing at all on /fokus (a
 * full-screen mode whose only exit is Afslut, spec traening.md §2).
 */
export function ScreenNav() {
  const pathname = usePathname();
  if (pathname === "/fokus" || pathname.startsWith("/fokus/")) return null;
  return (
    // @container/nav: when the tabs would wrap (200% text) the bar is not fixed but the static strip
    // at the top (DESIGN.md "Large text"), and a pill track would become a blob, so the wrapped track
    // takes rounded-card. The tabs need 3 × 6.5rem + gaps + padding = 20.5rem of track; the header
    // is the bar's 2 × 0.75rem gutters wider, so the query is 22rem.
    <header className="@container/nav mx-auto w-full max-w-content lg:max-w-wide lg:px-8 lg:pt-4 lg:pb-3">
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] @max-[22rem]/nav:static @max-[22rem]/nav:border-0 lg:static lg:border-0 lg:p-0">
        <nav aria-label="Hovedmenu">
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-1 rounded-pill bg-track p-1 @max-[22rem]/nav:rounded-card lg:inline-grid lg:grid-cols-3">
            {TABS.map((tab) => {
              const current = isCurrent(pathname, tab.href);
              return (
                <li key={tab.href} className="flex">
                  <Link
                    href={tab.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-pill px-3 text-16 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus lg:min-w-32 lg:px-5 ${
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
      </div>
    </header>
  );
}
