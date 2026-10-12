"use client";

import { useEffect, useState } from "react";

import { elapsedSeconds, formatTimer } from "@/lib/fokus-view";

/**
 * The rest view's count-up clock (spec traening.md §4.3): from the last done tap, so it survives
 * a reload. Re-renders once a second (the state is whole seconds); the digits never animate and
 * are never announced (role timer, aria-live off). The server's and the browser's clocks differ
 * by a moment, so the first text may be replaced on hydration (suppressHydrationWarning).
 */
export function RestTimer({ since }: { readonly since: string }) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(since, Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setSeconds(elapsedSeconds(since, Date.now())), 250);
    return () => window.clearInterval(id);
  }, [since]);
  return (
    <p
      role="timer"
      aria-live="off"
      aria-label="Pause"
      suppressHydrationWarning
      className="font-display text-56 font-extrabold tabular-nums italic"
    >
      {formatTimer(seconds)}
    </p>
  );
}
