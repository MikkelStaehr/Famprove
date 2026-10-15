"use client";

import { useEffect } from "react";

import { type WakeLockApi, wakeLockController } from "@/lib/wake-lock";

/**
 * Keeps the screen on while a Fokus session is open (fokus-flow.md §4): requested while `active`
 * (the log shows the session begun and it is not finished), again whenever the page becomes
 * visible, released when `active` turns false (the finished view) and on unmount (Afslut,
 * Tilbage til Træning). Unsupported or refused: nothing happens and nothing is shown.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api: WakeLockApi | undefined = "wakeLock" in navigator ? navigator.wakeLock : undefined;
    const lock = wakeLockController(api, () => document.visibilityState === "visible");
    const onVisibility = () => void lock.visibility();
    void lock.hold();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      lock.release();
    };
  }, [active]);
}
