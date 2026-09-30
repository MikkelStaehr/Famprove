"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "I dag" },
  { href: "/load", label: "Belastning" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * DESIGN.md ScreenNav (Part B): a --track pill with two tabs, not sticky. The current tab has
 * aria-current="page", a --text fill with --bg text and weight 700: fill and weight, never
 * colour alone (and deliberately not --slab).
 */
export function ScreenNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hovedmenu">
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-1 rounded-pill bg-track p-1">
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
  );
}
