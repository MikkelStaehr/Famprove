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
 * DESIGN.md ScreenNav (Part A "Layout: phone and desktop", Part B Revision 5): three equal text
 * tabs, no pill track. Below lg a fixed bottom bar (--bg + the grain, 1px --border hairline, no
 * shadow, --bottom-bar high); from lg a static top bar in the frame, the tabs left-aligned. The
 * <header> stays in flow before <main> at every width, so keyboard users meet the nav first; only
 * its position changes. The current tab has aria-current="page", --text, weight 500 and a 2px --text
 * bar (bottom bar: on the tab's top edge, over the hairline; top bar: under the word, offset 6px);
 * the others are weight 400 --text-muted: weight + bar, never colour alone. Nothing at all on
 * /fokus (a full-screen mode whose only exit is Afslut, spec traening.md §2).
 */
export function ScreenNav() {
  const pathname = usePathname();
  if (pathname === "/fokus" || pathname.startsWith("/fokus/")) return null;
  return (
    // @container/nav: when the tabs would wrap (200% text) the bar is not fixed but the static strip
    // at the top (DESIGN.md "Large text"), and the bar sits under each word as on desktop. The tabs
    // need 3 × 6.5rem + gaps = 19.5rem; the header is the bar's 2 × 0.75rem gutters wider, so the
    // query is 22rem (unchanged).
    <header className="@container/nav mx-auto w-full max-w-content lg:max-w-wide lg:px-8 lg:pt-4 lg:pb-3">
      <div className="grain-bar fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] pb-[max(8px,env(safe-area-inset-bottom))] @max-[22rem]/nav:relative @max-[22rem]/nav:border-0 @max-[22rem]/nav:py-2 lg:relative lg:border-0 lg:p-0">
        <nav aria-label="Hovedmenu">
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-x-1 lg:inline-grid lg:grid-cols-3 lg:gap-x-6">
            {TABS.map((tab) => {
              const current = isCurrent(pathname, tab.href);
              return (
                <li key={tab.href} className="flex">
                  <Link
                    href={tab.href}
                    aria-current={current ? "page" : undefined}
                    className={`relative inline-flex min-h-11 flex-1 items-center justify-center px-3 text-16 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus lg:justify-start lg:px-0 ${
                      current
                        ? "font-medium text-text before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-text @max-[22rem]/nav:before:hidden lg:before:hidden"
                        : "font-normal text-text-muted"
                    }`}
                  >
                    {current ? (
                      // Under the word (top bar, large text): a 2px bar 6px below the text's box.
                      <span className="relative after:absolute after:inset-x-0 after:top-[calc(100%+6px)] after:hidden after:h-0.5 after:bg-text @max-[22rem]/nav:after:block lg:after:block">
                        {tab.label}
                      </span>
                    ) : (
                      tab.label
                    )}
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
