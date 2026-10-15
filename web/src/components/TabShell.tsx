"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { TabBar } from "./TabBar";
import { pageStyle, TAB_COUNT, TABS, tabIndex } from "@/lib/tab-shell";

/**
 * The tab shell (slice motion-shell; docs/decisions/tab-shell.md, design/specs/motion-shell.md):
 * all three tabs mounted, stacked as cards at position p. The URL owns the settled tab: a tap
 * pushes its path (history.pushState: no request, no remount), back/forward and deep links set it.
 * Each page is its own scroll container; the inactive ones are inert and hidden at rest.
 */
export function TabShell({ pages }: { readonly pages: readonly ReactNode[] }) {
  const pathname = usePathname();
  const index = tabIndex(pathname);
  // The last path seen per tab, so returning to Analyse lands on the section it was left on.
  const lastPath = useRef<string[]>(TABS.map((t) => t.path));
  useEffect(() => {
    lastPath.current[index] = pathname;
    document.title = TABS[index].label;
  }, [index, pathname]);

  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(TAB_COUNT - 1, i));
      if (target === index) return;
      window.history.pushState(null, "", lastPath.current[target]);
    },
    [index],
  );

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <div className="relative min-h-0 flex-1 overflow-hidden lg:order-last">
        {pages.map((page, i) => {
          const s = pageStyle(i, index);
          const active = i === index;
          return (
            <div
              key={TABS[i].path}
              data-tab-page={TABS[i].path}
              data-active={active ? "" : undefined}
              className="absolute inset-0 origin-[50%_40%] overflow-hidden bg-bg"
              style={{ transform: s.transform, borderRadius: s.borderRadius, boxShadow: s.boxShadow, visibility: s.visibility, zIndex: s.zIndex }}
              inert={!active}
              aria-hidden={!active}
            >
              <main className="h-full overflow-y-auto overscroll-y-contain">
                <div className="mx-auto flex w-full max-w-content flex-col gap-3 pt-[max(20px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-6 pl-[max(16px,env(safe-area-inset-left))] lg:max-w-wide lg:gap-6 lg:px-8 lg:pt-0 lg:pb-12">
                  {page}
                </div>
              </main>
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: s.scrim }} />
            </div>
          );
        })}
      </div>
      <TabBar index={index} onSelect={goTo} />
    </div>
  );
}
