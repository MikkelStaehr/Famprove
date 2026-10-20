"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, type PointerEvent, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { useMedia } from "./chart-hooks";
import { TabBar } from "./TabBar";
import { MinimisedBar } from "./MinimisedBar";
import { ClipPlayerHost } from "./ClipPlayerHost";
import type { FokusSnapshot } from "@/lib/fokus-snapshot";
import { DUR, easeOutQuart, REDUCED_MOTION } from "@/lib/motion";
import { dragLock, dragPosition, edgeStart, pageStyle, releaseTarget, TAB_COUNT, TABS, tabIndex, tabTitle } from "@/lib/tab-shell";

type Drag = { x: number; y: number; t: number; id: number; lock: "x" | null; dx: number };

const REDUCE = REDUCED_MOTION;

/**
 * "This tab became active" for entry motion (the curve drawing itself, Analyse's bars): per tab a
 * count of entries after first paint, so a hard load or reload never animates (DESIGN.md Motion).
 */
const TabEntries = createContext<readonly number[]>([0, 0, 0]);

/** How often tab `i` has been entered since first paint; an effect keyed on it plays the entry. */
export function useTabEntry(i: number): number {
  return useContext(TabEntries)[i] ?? 0;
}

/**
 * The tab shell (slice motion-shell; docs/decisions/tab-shell.md, design/specs/motion-shell.md):
 * all three tabs mounted, stacked as cards at position p. The URL owns the settled tab: a tap
 * pushes its path (history.pushState: no request, no remount), back/forward and deep links set it.
 * Each page is its own scroll container; the inactive ones are inert and hidden at rest (render() switches both).
 * p lives in a ref and every frame writes the styles straight to the frames, scrims and the bar's
 * indicator; React renders them once, at the first paint's index, and never touches them again.
 */
export function TabShell({
  pages,
  today,
  devSnapshot,
}: {
  readonly pages: readonly ReactNode[];
  /** The screen's date (DEV_TODAY aware): a Fokus snapshot from another day is cleared. */
  readonly today: string;
  /** DEV_FIXTURE=minimised*: the snapshot the server built from real taps (fokus-minimise.md §4). */
  readonly devSnapshot?: FokusSnapshot | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const index = tabIndex(pathname);
  // Entries after first paint, per tab (useTabEntry): the settled index changing is an entry.
  const [entries, setEntries] = useState<readonly number[]>([0, 0, 0]);
  const enteredIndex = useRef(index);
  useEffect(() => {
    if (enteredIndex.current === index) return;
    enteredIndex.current = index;
    setEntries((e) => e.map((n, i) => (i === index ? n + 1 : n)));
  }, [index]);
  // The first paint (server render = hydration) is the settled state; React never rewrites these styles.
  const [first] = useState(index);
  const lg = useMedia("(min-width: 1024px)");

  const p = useRef(index);
  const target = useRef(index);
  const raf = useRef(0);
  const moving = useRef(false);
  const width = useRef(1);
  const viewport = useRef<HTMLDivElement | null>(null);
  const frames = useRef<(HTMLDivElement | null)[]>([]);
  const scrims = useRef<(HTMLDivElement | null)[]>([]);
  const indicator = useRef<HTMLSpanElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);

  // The last URL seen per tab (path and search: Belastning's ?week=), so returning to a tab lands
  // where it was left: Analyse on its section, Belastning on its week. goTo stores the URL it leaves.
  const lastPath = useRef<string[]>(TABS.map((t) => t.path));
  // A tab activated from a page's strip (200 % text): its link in the new page's strip takes the focus.
  const focusTab = useRef<string | null>(null);
  useEffect(() => {
    document.title = tabTitle(pathname);
    const path = focusTab.current;
    focusTab.current = null;
    if (path !== null) {
      document.querySelector<HTMLElement>(`[data-tab-page][data-active] [data-tab-strip] a[href="${path}"]`)?.focus();
    }
  }, [index, pathname]);

  const render = useCallback((pos: number) => {
    p.current = pos;
    for (let i = 0; i < TAB_COUNT; i += 1) {
      const el = frames.current[i];
      if (el == null) continue;
      const s = pageStyle(i, pos);
      el.style.transform = s.transform;
      el.style.borderRadius = s.borderRadius;
      el.style.boxShadow = s.boxShadow;
      // Hidden and inert switch together, and only here: each switch makes the browser restyle the whole
      // page (~300-700 elements, 30-60 ms at 4x CPU), so one pass per page per move, never a second one
      // from React's commit at the release. The target page shows from the move's first frame (off-screen
      // or under the current page), so a tap's focus can land in it before the commit.
      const hidden = s.visibility === "hidden" && i !== target.current;
      if (el.inert !== hidden) {
        el.style.visibility = hidden ? "hidden" : "visible";
        el.inert = hidden;
        if (hidden) el.setAttribute("aria-hidden", "true");
        else el.removeAttribute("aria-hidden");
      }
      el.style.willChange = moving.current ? "transform" : "";
      const scrim = scrims.current[i];
      if (scrim != null) scrim.style.opacity = String(s.scrim);
    }
    if (indicator.current !== null) {
      indicator.current.style.transform = `translateX(${Math.max(0, Math.min(TAB_COUNT - 1, pos)) * 100}%)`;
    }
  }, []);

  /** p from where it is to `to` over 440 ms easeOutQuart; a snap under reduced motion. Cancels any running one. */
  const animateTo = useCallback(
    (to: number) => {
      cancelAnimationFrame(raf.current);
      target.current = to;
      const from = p.current;
      if (from === to || window.matchMedia(REDUCE).matches) {
        moving.current = false;
        render(to);
        return;
      }
      moving.current = true;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - t0) / DUR.stack));
        if (t >= 1) {
          moving.current = false;
          render(to);
          return;
        }
        render(from + (to - from) * easeOutQuart(t));
        raf.current = requestAnimationFrame(step);
      };
      step(t0);
    },
    [render],
  );

  const goTo = useCallback(
    (i: number) => {
      const to = Math.max(0, Math.min(TAB_COUNT - 1, i));
      if (to === index) {
        // The current tab's own link from a section (Styrke): back to its first section, as a Link was.
        if (window.location.pathname !== TABS[to].path) router.push(TABS[to].path);
        return;
      }
      lastPath.current[index] = window.location.pathname + window.location.search;
      if (document.activeElement?.closest("[data-tab-strip]") != null) focusTab.current = TABS[to].path;
      window.history.pushState(null, "", lastPath.current[to]);
      animateTo(to);
    },
    [index, animateTo, router],
  );

  // Back/forward (or any URL change to another tab not started here): animate to the URL's tab.
  // A path change inside a tab (/analyse -> /analyse/styrke) keeps the index, so p stays.
  useEffect(() => {
    if (target.current !== index) animateTo(index);
  }, [index, animateTo]);

  // The width, read on resize only (never in the frame loop).
  useEffect(() => {
    const measure = () => {
      width.current = Math.max(1, viewport.current?.clientWidth ?? 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    if (lg) return;
    if (e.target instanceof Element && e.target.closest("[data-noswipe]") !== null) return;
    if (edgeStart(e.clientX, window.innerWidth)) return;
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, lock: null, dx: 0 };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.lock === null) {
      const lock = dragLock(dx, dy);
      if (lock === "y") {
        drag.current = null; // a scroll: the page has it
        return;
      }
      if (lock === null) return;
      d.lock = "x";
      try {
        e.currentTarget.setPointerCapture(d.id);
      } catch {
        // The pointer is already gone; the drag still follows its moves.
      }
    }
    d.dx = dx;
    cancelAnimationFrame(raf.current);
    moving.current = true;
    render(dragPosition(index, dx, width.current));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || e.pointerId !== d.id) return;
    drag.current = null;
    if (d.lock !== "x") return;
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 60);
    const to = releaseTarget(index, d.dx, Math.max(1, performance.now() - d.t), width.current);
    if (to !== index) goTo(to);
    else animateTo(index);
  };

  // The click that ends a locked drag never reaches the page.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <TabEntries value={entries}>
    <ClipPlayerHost>
    <div className="@container/shell flex h-dvh flex-col bg-bg">
      {/* First in the DOM (focus order: the nav before the pages, WCAG 2.4.3); shown last below lg. */}
      <TabBar index={index} onSelect={goTo} indicatorRef={indicator} />
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {pages.map((page, i) => {
          const s = pageStyle(i, first);
          const active = i === index;
          return (
            <div
              key={TABS[i].path}
              ref={(el) => {
                frames.current[i] = el;
              }}
              data-tab-page={TABS[i].path}
              data-active={active ? "" : undefined}
              className="absolute inset-0 origin-[50%_40%] touch-pan-y overflow-hidden bg-bg"
              style={{ transform: s.transform, borderRadius: s.borderRadius, boxShadow: s.boxShadow, visibility: s.visibility, zIndex: s.zIndex }}
              // At the first paint's index only, like the styles: render() switches them (with visibility) after.
              inert={i !== first}
              aria-hidden={i !== first}
            >
              <main className="h-full touch-pan-y overflow-y-auto overscroll-y-contain">
                {/* 200 % text: the tab strip at the top of the page, scrolling away with it (TabBar). */}
                <TabBar index={index} onSelect={goTo} placement="strip" />
                <div className="mx-auto flex w-full max-w-content flex-col gap-3 pt-[max(20px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-6 pl-[max(16px,env(safe-area-inset-left))] lg:max-w-wide lg:gap-6 lg:px-8 lg:pt-0 lg:pb-12">
                  {page}
                </div>
              </main>
              <div
                ref={(el) => {
                  scrims.current[i] = el;
                }}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-black"
                style={{ opacity: s.scrim }}
              />
            </div>
          );
        })}
      </div>
      {/* fokus-minimise.md §2: Fokus's bar, a flex sibling under the pages (the scroll container shrinks), above the TabBar below lg. */}
      <MinimisedBar today={today} {...(devSnapshot === undefined ? {} : { devSnapshot })} />
    </div>
    </ClipPlayerHost>
    </TabEntries>
  );
}
