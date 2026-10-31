/**
 * The automatic clip's switch (slice clip-auto-park, user 2026-10-20; on by default again since
 * slice clip-auto-on, user 2026-10-31). localStorage `famprove.clips.autoClipV2` = "off" turns it
 * off; absent or any other value is on, so a phone left off by the park turns on once. The old key
 * `famprove.clips.autoClip` is ignored and removed. Unreadable or no storage is off (nothing can
 * be recorded about the clip then). Off: no pickup, no analysis after Stop, no auto words, auto
 * ranges ignored in the cut. Storage is injected, so node tests it.
 */
import type { KeyStore } from "./auto-version.ts";

export const AUTO_CLIP_KEY = "famprove.clips.autoClipV2";
/** The parked switch's key (absent = off): ignored, and removed where the storage allows. */
export const OLD_AUTO_CLIP_KEY = "famprove.clips.autoClip";

/** The switch: on unless the key reads "off"; the old key is ignored (and removed when the store can). */
export function autoClipOn(store: (Pick<Storage, "getItem"> & Partial<Pick<Storage, "removeItem">>) | null): boolean {
  if (store === null) return false;
  try {
    if (store.removeItem !== undefined && store.getItem(OLD_AUTO_CLIP_KEY) !== null) store.removeItem(OLD_AUTO_CLIP_KEY);
  } catch {
    // ignored: the old key is never read
  }
  try {
    return store.getItem(AUTO_CLIP_KEY) !== "off";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

/** Stores the switch (the key removed = on, or "off") and tells subscribers; a blocked storage is ignored (the switch then reads as before). */
export function setAutoClipOn(store: (KeyStore & Pick<Storage, "removeItem">) | null, on: boolean): void {
  try {
    if (store !== null) {
      store.removeItem(OLD_AUTO_CLIP_KEY);
      if (on) store.removeItem(AUTO_CLIP_KEY);
      else store.setItem(AUTO_CLIP_KEY, "off");
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
