"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

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
