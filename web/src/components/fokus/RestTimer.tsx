"use client";

import { useEffect, useState } from "react";

import { elapsedSeconds, formatTimer } from "@/lib/fokus-view";

/**
 * Whole seconds since `since`, re-rendered once a second (a clock, not data: it survives a reload
 * because `since` comes from the set log).
 */
export function useElapsed(since: string): number {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(since, Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setSeconds(elapsedSeconds(since, Date.now())), 250);
    return () => window.clearInterval(id);
  }, [since]);
  return seconds;
}

/**
 * The count-up clock (traening.md §4.3, fokus-pause.md §2.2, §3.2). The digits never animate,
 * never change colour (fokus-instrument.md §4.3) and are never announced (role timer, aria-live
 * off). The server's and the browser's clocks differ by a moment, so the first text may be
 * replaced on hydration (suppressHydrationWarning).
 */
export function RestTimer({ seconds, label }: { readonly seconds: number; readonly label: "Pause" | "Opvarmning" }) {
  return (
    <p
      role="timer"
      aria-live="off"
      aria-label={label}
      suppressHydrationWarning
      className="font-mono text-56 leading-none font-medium text-text tabular-nums"
    >
      {formatTimer(seconds)}
    </p>
  );
}
