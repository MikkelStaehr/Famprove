"use client";

import { usePathname } from "next/navigation";
import { type PointerEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useMedia } from "./chart-hooks";
import { TabBar } from "./TabBar";
import { DUR, easeOutQuart } from "@/lib/motion";
import { dragLock, dragPosition, edgeStart, pageStyle, releaseTarget, TAB_COUNT, TABS, tabIndex } from "@/lib/tab-shell";

type Drag = { x: number; y: number; t: number; id: number; lock: "x" | null; dx: number };

const REDUCE = "(prefers-reduced-motion: reduce)";

/**
 * The tab shell (slice motion-shell; docs/decisions/tab-shell.md, design/specs/motion-shell.md):
 * all three tabs mounted, stacked as cards at position p. The URL owns the settled tab: a tap
 * pushes its path (history.pushState: no request, no remount), back/forward and deep links set it.
 * Each page is its own scroll container; the inactive ones are inert and hidden at rest.
 * p lives in a ref and every frame writes the styles straight to the frames, scrims and the bar's
 * indicator; React renders them once, at the first paint's index, and never touches them again.
 */
export function TabShell({ pages }: { readonly pages: readonly ReactNode[] }) {
  const pathname = usePathname();
  const index = tabIndex(pathname);
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

  // The last path seen per tab, so returning to Analyse lands on the section it was left on.
  const lastPath = useRef<string[]>(TABS.map((t) => t.path));
  useEffect(() => {
    lastPath.current[index] = pathname;
    document.title = TABS[index].label;
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
      el.style.visibility = s.visibility;
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
      if (to !== index) window.history.pushState(null, "", lastPath.current[to]);
      animateTo(to);
    },
    [index, animateTo],
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
    <div className="@container/shell flex h-dvh flex-col bg-bg">
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 overflow-hidden lg:order-last"
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
              inert={!active}
              aria-hidden={!active}
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
      <TabBar index={index} onSelect={goTo} indicatorRef={indicator} />
    </div>
  );
}
