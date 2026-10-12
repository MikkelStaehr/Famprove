"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while Fokus is visible (spec traening.md §4.5): requested on mount and
 * again whenever the page becomes visible, released when it is hidden and on unmount (Afslut,
 * Tilbage til Træning). Unsupported or refused: nothing happens and nothing is shown.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let mounted = true;

    const release = () => {
      const held = sentinel;
      sentinel = null;
      held?.release().catch(() => undefined); // already released by the browser: fine
    };
    const request = async () => {
      if (sentinel !== null && !sentinel.released) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (mounted && document.visibilityState === "visible") sentinel = lock;
        else lock.release().catch(() => undefined);
      } catch {
        // refused (battery saver, no user activation): an enhancement only
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
      else release();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, []);
}
