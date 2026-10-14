"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/icons";

const TABS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Træning", icon: "barbell" },
  { href: "/load", label: "Belastning", icon: "trend" },
  { href: "/analyse", label: "Analyse", icon: "bars" },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * DESIGN.md TabBar (Part A "Navigation", Part B Ember). One <header><nav> before <main> at every
 * width; only its position changes.
 * - Below lg: a fixed bottom bar (--bg, 1px --border top), three equal tabs, each a 22px icon over
 *   a text-11 Geist label, gap 4px, min-w-16, padding 6px; the bar 10px top padding and
 *   max(24px, safe-area) bottom. Each tab is ≥ 44 × 44.
 * - When the labels would wrap (@max-[20.5rem] on the nav, 200% text) the bar falls back to a
 *   static strip at the top of the page.
 * - From lg: a static top bar in the frame, 16px from the top and 24px above the h1: a --card track
 *   (1px --border, --radius-button, 4px padding) of 44px tabs, 20px icon + text-14 500 label.
 * Current tab: aria-current="page", --text icon and label at weight 600 (+ the --raised fill on
 * desktop); the others --text-muted at 400. Weight + colour (+ fill), never colour alone.
 * Nothing at all on /fokus (a full-screen mode whose only exit is Afslut).
 */
export function TabBar() {
  const pathname = usePathname();
  if (pathname === "/fokus" || pathname.startsWith("/fokus/")) return null;
  return (
    <header className="@container/nav mx-auto w-full max-w-content lg:max-w-wide lg:px-8 lg:pt-4 lg:pb-6">
      <nav
        aria-label="Hovedmenu"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg pt-2.5 pr-[max(16px,env(safe-area-inset-right))] pb-[max(24px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] @max-[20.5rem]/nav:static @max-[20.5rem]/nav:border-t-0 @max-[20.5rem]/nav:pb-2.5 lg:static lg:inline-flex lg:rounded-button lg:border lg:border-border lg:bg-card lg:p-1"
      >
        <ul className="flex flex-wrap justify-around lg:flex-nowrap lg:gap-1">
          {TABS.map((tab) => {
            const current = isCurrent(pathname, tab.href);
            return (
              <li key={tab.href} className="flex">
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 min-w-16 flex-col items-center justify-center gap-1 p-1.5 font-sans text-11 transition-colors duration-[120ms] ease-out lg:min-h-11 lg:flex-row lg:gap-2 lg:rounded-control lg:px-4 lg:py-0 lg:text-14 ${
                    current ? "font-semibold text-text lg:bg-raised" : "font-normal text-text-muted"
                  }`}
                >
                  <Icon name={tab.icon} size={22} className="lg:hidden" />
                  <Icon name={tab.icon} size={20} className="hidden lg:block" />
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
