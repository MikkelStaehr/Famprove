"use client";

import { type MouseEvent, type Ref, useState } from "react";

import { Icon, type IconName } from "@/components/icons";
import { TABS as SHELL_TABS } from "@/lib/tab-shell";

const ICONS: readonly IconName[] = ["barbell", "trend", "bars"];

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
 * In the tab shell (motion-shell): the bar sits in the shell's column (bottom below lg, top from
 * lg), never over the pages; a tap changes the tab through `onSelect` (history.pushState, no
 * navigation); the href stays for a new tab or window. /fokus has no shell, so no bar.
 * Indicator (phone bar only): a track one tab wide on the bar's top edge, holding a 28px 2px --text
 * bar; TabShell translates it by p × 100 % of its own width. None at lg or on the 200 % strip.
 */
export function TabBar({
  index,
  onSelect,
  indicatorRef,
}: {
  readonly index: number;
  readonly onSelect: (i: number) => void;
  /** The indicator's track: TabShell moves it to p every frame (its first paint sits at `index`). */
  readonly indicatorRef?: Ref<HTMLSpanElement>;
}) {
  // The indicator's first paint only: React never rewrites its transform, TabShell owns it after mount.
  const [firstIndex] = useState(index);
  const select = (i: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // a new tab/window
    e.preventDefault();
    onSelect(i);
  };
  return (
    <header className="@container/nav mx-auto w-full max-w-content lg:order-first lg:max-w-wide lg:px-8 lg:pt-4 lg:pb-6">
      <nav
        aria-label="Hovedmenu"
        className="relative border-t border-border bg-bg pt-2.5 pr-[max(16px,env(safe-area-inset-right))] pb-[max(24px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] @max-[20.5rem]/nav:border-t-0 @max-[20.5rem]/nav:pb-2.5 lg:inline-flex lg:rounded-button lg:border lg:border-border lg:bg-card lg:p-1"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-px right-[max(16px,env(safe-area-inset-right))] left-[max(16px,env(safe-area-inset-left))] h-0.5 @max-[20.5rem]/nav:hidden lg:hidden"
        >
          <span ref={indicatorRef} className="block h-0.5 w-1/3" style={{ transform: `translateX(${firstIndex * 100}%)` }}>
            <span className="mx-auto block h-0.5 w-7 rounded-[1px] bg-text" />
          </span>
        </span>
        <ul className="flex flex-wrap justify-around lg:flex-nowrap lg:gap-1">
          {SHELL_TABS.map((tab, i) => {
            const current = i === index;
            return (
              <li key={tab.path} className="flex">
                <a
                  href={tab.path}
                  onClick={select(i)}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 min-w-16 flex-col items-center justify-center gap-1 p-1.5 font-sans text-11 transition-colors duration-[120ms] ease-out lg:min-h-11 lg:flex-row lg:gap-2 lg:rounded-control lg:px-4 lg:py-0 lg:text-14 ${
                    current ? "font-semibold text-text lg:bg-raised" : "font-normal text-text-muted"
                  }`}
                >
                  <Icon name={ICONS[i]} size={22} className="lg:hidden" />
                  <Icon name={ICONS[i]} size={20} className="hidden lg:block" />
                  {tab.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
