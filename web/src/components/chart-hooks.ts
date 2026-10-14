"use client";

import { catchError, type ErrorInfo } from "next/error";
import { createElement, useCallback, useState, useSyncExternalStore } from "react";

import { ErrorState } from "./ErrorState";

/** A media query's match (false on the server and during hydration). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const q = window.matchMedia(query);
      q.addEventListener("change", onChange);
      return () => q.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A callback ref + the element's content width (null until measured: the SVG draws after hydration). */
export function useWidth(): readonly [(el: HTMLDivElement | null) => (() => void) | undefined, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (el === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const subscribeNothing = () => () => {};

/** false on the server and during hydration, true afterwards (the chart measures the DOM). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/** true from 640px: 9 ticks every 14 days instead of 5 every 28 (load.md §9a). */
export function useWide(): boolean {
  return useMedia("(min-width: 640px)");
}

function ChartFailed({ what }: { readonly what: string }, { reset }: ErrorInfo) {
  return createElement(ErrorState, { title: "Grafen kan ikke vises", what, retry: { onRetry: reset } });
}

/** A chart's error boundary: a render failure shows ErrorState with a retry, not a blank page. */
export const ChartBoundary = catchError(ChartFailed);
