"use client";

import { createContext, type ReactNode, use, useEffect, useState, useSyncExternalStore } from "react";

import type { LibraryRow } from "@/lib/video/library-view";

/**
 * The clip player's host (slice clip-at-set §3), mounted once in the tabs shell: Optagelser
 * (ClipLibrary, always mounted with Træning) publishes its rows and its one Player's opener here,
 * so a ▶ on Træning's list or the week card (Træning and Belastning) opens that same Player, with
 * its trim and delete timers, which stay at library level. One player implementation.
 */
export type ClipOpener = (id: string, opener: HTMLElement, afterDelete: () => HTMLElement | null) => void;

type Snapshot = { readonly rows: readonly LibraryRow[] | null; readonly open: ClipOpener | null };

export type ClipPlayerStore = {
  readonly get: () => Snapshot;
  readonly subscribe: (fn: () => void) => () => void;
  readonly publish: (next: Snapshot) => void;
};

const EMPTY: Snapshot = { rows: null, open: null };

export function clipPlayerStore(): ClipPlayerStore {
  let snap = EMPTY;
  const subs = new Set<() => void>();
  return {
    get: () => snap,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    publish: (next) => {
      if (next.rows === snap.rows && next.open === snap.open) return;
      snap = next;
      for (const fn of subs) fn();
    },
  };
}

const HostContext = createContext<ClipPlayerStore | null>(null);

export function ClipPlayerHost({ children }: { readonly children: ReactNode }) {
  const [store] = useState(clipPlayerStore);
  return <HostContext value={store}>{children}</HostContext>;
}

const serverSnapshot = () => EMPTY;

/** The library's rows and opener; rows null until the phone's index has been read (after hydration). */
export function useClipPlayer(): Snapshot {
  const store = use(HostContext);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? serverSnapshot, serverSnapshot);
}

const noSubscribe = () => () => {};

/** ClipLibrary's side: publish the rows (null while loading or on a read error) and the opener. */
export function usePublishClips(rows: readonly LibraryRow[] | null, open: ClipOpener): void {
  const store = use(HostContext);
  useEffect(() => {
    store?.publish({ rows, open });
  }, [store, rows, open]);
  useEffect(() => () => store?.publish(EMPTY), [store]);
}
