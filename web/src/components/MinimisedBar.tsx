"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { useElapsed } from "@/components/fokus/RestTimer";
import { useWakeLock } from "@/components/fokus/useWakeLock";
import { barCaption, type FokusSnapshot, nextLine, readSnapshot, sessionStore, sharedVibrator, SNAPSHOT_EVENT, writeSnapshot } from "@/lib/fokus-snapshot";
import { formatTimer, restBand, restMinutes } from "@/lib/fokus-view";
import { type RestSignal, restSignal } from "@/lib/rest-signal";

const store = sessionStore;

/**
 * Fokus › Minimér's bar (design/specs/fokus-minimise.md §2): a flex sibling between the tab pages
 * and the TabBar, never an overlay. Shown while a snapshot for `today` exists; one link back to
 * Fokus at the same set. `devSnapshot` (DEV_FIXTURE=minimised*): the server's snapshot, written
 * by the same writer before it is read.
 */
export function MinimisedBar({ today, devSnapshot }: { readonly today: string; readonly devSnapshot?: FokusSnapshot | null }) {
  const [snap, setSnap] = useState<FokusSnapshot | null>(null);
  useEffect(() => {
    if (devSnapshot !== undefined) writeSnapshot(store(), devSnapshot);
    const read = () => setSnap(readSnapshot(store(), today));
    read();
    window.addEventListener(SNAPSHOT_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(SNAPSHOT_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [today, devSnapshot]);
  // §2: the bar holds the screen on while it is shown (released on unmount and when hidden).
  useWakeLock(snap !== null);
  if (snap === null) return null;
  return (
    <div className="mx-auto w-full max-w-content bg-bg py-2 pr-[max(16px,env(safe-area-inset-right))] pl-[max(16px,env(safe-area-inset-left))] transition-opacity duration-160 ease-(--ease-ember) starting:opacity-0 motion-reduce:transition-none lg:max-w-wide lg:px-8">
      <Bar snap={snap} />
    </div>
  );
}

function Bar({ snap }: { readonly snap: FokusSnapshot }) {
  const line = nextLine(snap.next);
  return (
    <Link
      href="/fokus"
      className="flex min-h-(--h-fokus-bar) items-center gap-3 rounded-button border border-text-muted bg-card px-3.5 py-2 text-text"
    >
      <span className="sr-only">Tilbage til Fokus. </span>
      {snap.restSince !== null && <BarTimer since={snap.restSince} minS={snap.restMinS} />}
      <span className="flex min-w-0 flex-1 flex-col">
        {snap.restSince === null ? (
          <span className="font-mono text-11 text-text-muted uppercase">Næste</span>
        ) : (
          <BarCaption since={snap.restSince} minS={snap.restMinS} maxS={snap.restMaxS} />
        )}
        <span className="flex min-w-0 font-sans text-14 text-text">
          <span className="shrink-0 whitespace-pre">Næste · </span>
          <span className="min-w-0 truncate">{line.name}</span>
          <span className="shrink-0 whitespace-pre">{line.rest}</span>
        </span>
      </span>
      <Icon name="chevron-up" size={20} className="shrink-0 text-text-muted" />
    </Link>
  );
}

/** The count-up digits (aria-hidden) with an sr-only minute line, and the one signal at the minimum. */
function BarTimer({ since, minS }: { readonly since: string; readonly minS: number | null }) {
  const seconds = useElapsed(since);
  const signal = useRef<{ readonly since: string; readonly s: RestSignal } | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (signal.current?.since !== since) signal.current = { since, s: restSignal(since, minS, sharedVibrator(store(), since, navigator)) };
    if (signal.current.s.tick(Date.now(), document.visibilityState === "visible")) setSaid("Klar til næste sæt.");
  }, [seconds, since, minS]);
  return (
    <span className="shrink-0">
      <span aria-hidden="true" suppressHydrationWarning className="font-mono text-24 font-medium text-text tabular-nums">
        {formatTimer(seconds)}
      </span>
      <span className="sr-only">{`Pause ${formatTimer(Math.floor(seconds / 60) * 60)}. `}</span>
      <span role="status" className="sr-only">
        {said}
      </span>
    </span>
  );
}

function BarCaption({ since, minS, maxS }: { readonly since: string; readonly minS: number | null; readonly maxS: number | null }) {
  const seconds = useElapsed(since);
  const band = restBand(seconds, minS, maxS).kind;
  const caption = barCaption(band, minS === null || maxS === null ? null : { min: restMinutes(minS), max: restMinutes(maxS) });
  const tone = band === "over" ? "text-warning" : band === "ready" ? "text-text" : "text-text-muted";
  return (
    <span className={`flex items-center gap-1 font-mono text-11 uppercase ${tone}`}>
      {caption.icon !== null && <Icon name={caption.icon} size={16} className="shrink-0" />}
      {caption.text}
    </span>
  );
}
