"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today" },
  { href: "/load", label: "Training load" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * DESIGN.md ScreenNav: two tabs in the root layout, not sticky. The current tab has
 * aria-current="page", semibold --text and a 2px --text bar on the strip line; the other is
 * regular --accent. Weight and bar mark the current page, so colour is never the only signal.
 */
export function ScreenNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="flex gap-2 border-b border-border">
        {TABS.map((tab) => {
          const current = isCurrent(pathname, tab.href);
          return (
            // -mb-px puts the link's 2px bottom bar on top of the strip's 1px line.
            <li key={tab.href} className="-mb-px">
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-16 ${
                  current ? "border-text font-semibold text-text" : "border-transparent text-accent"
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
