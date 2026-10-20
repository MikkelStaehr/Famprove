/**
 * The automatic clip's switch (slice clip-auto-park, user 2026-10-20): parked, off by default.
 * localStorage `famprove.clips.autoClip` = "on" turns it on; absent, any other value or an
 * unreadable storage is off. Off: no pickup, no analysis after Stop, no auto words, auto ranges
 * ignored in the cut. Storage is injected, so node tests it.
 */
import type { KeyStore } from "./auto-version.ts";

export const AUTO_CLIP_KEY = "famprove.clips.autoClip";

/** The switch: on only when the key reads "on". */
export function autoClipOn(store: Pick<Storage, "getItem"> | null): boolean {
  try {
    return store?.getItem(AUTO_CLIP_KEY) === "on";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

/** Stores the switch ("on", or the key removed) and tells subscribers; a blocked storage is ignored (it then stays off). */
export function setAutoClipOn(store: (KeyStore & Pick<Storage, "removeItem">) | null, on: boolean): void {
  try {
    if (store !== null) {
      if (on) store.setItem(AUTO_CLIP_KEY, "on");
      else store.removeItem(AUTO_CLIP_KEY);
    }
  } catch {
    // ignored: see above
  }
  for (const l of listeners) l();
}

/** useSyncExternalStore's subscribe: this tab's setAutoClipOn calls (the switch lives on one phone). */
export function subscribeAutoClip(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fokus after Stop (and the recording strip's reserved slot): an MP4 clip gets the analysis only while the switch is on. */
export function analysesAfterStop(ext: "mp4" | "webm", on: boolean): boolean {
  return ext === "mp4" && on;
}

/** window.localStorage (with removeItem, for the switch), or null where it can't be reached. */
export function switchStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
