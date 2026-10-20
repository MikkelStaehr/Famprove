"use client";

import { useEffect, useRef, useState } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { setClipButtons } from "@/lib/video/set-clips";

import { useClipPlayer } from "./ClipPlayerHost";
import { Icon } from "./icons";

const NONE: ReadonlySet<string> = new Set();

/**
 * The Klip row (clip-at-set.md §1): one ▶ per clip of the exercise's sets on this phone. A clip is
 * only ever added while its region (Træning's exercise, the week card's day <details>) is closed,
 * so nothing visible moves when the index lands (§5); a removal (Slet) and its Fortryd show at once.
 * The focus target after a Slet from the Player is the next ▶, else the scope's [data-clip-fallback].
 */
export function SetClips({
  date,
  session,
  rows,
  open,
  className = "",
}: {
  readonly date: IsoDate;
  readonly session: number;
  readonly rows: readonly number[];
  /** Træning's expanded state (re-checks the region when it closes); the week card's <details> is watched for toggle. */
  readonly open?: boolean;
  readonly className?: string;
}) {
  const { rows: all, open: play } = useClipPlayer();
  const buttons = all === null ? [] : setClipButtons(all, date, session, rows);
  const ids = buttons.map((b) => b.id).join(",");
  const anchor = useRef<HTMLSpanElement>(null);
  const [known, setKnown] = useState<ReadonlySet<string>>(NONE);
  const [toggles, setToggles] = useState(0);

  useEffect(() => {
    const details = anchor.current?.closest("details");
    if (details === null || details === undefined) return;
    const onToggle = () => setToggles((n) => n + 1);
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);

  useEffect(() => {
    const region = anchor.current?.closest("details, [data-expanded]");
    const closed = region instanceof HTMLDetailsElement ? !region.open : region?.getAttribute("data-expanded") !== "true";
    if (!closed) return;
    setKnown((prev) => {
      const next = ids === "" ? [] : ids.split(",");
      return next.length === prev.size && next.every((id) => prev.has(id)) ? prev : new Set([...prev, ...next]);
    });
  }, [ids, open, toggles]);

  const shown = buttons.filter((b) => known.has(b.id));
  return (
    <>
      <span ref={anchor} hidden />
      {shown.length > 0 && play !== null && (
        <div className={`flex flex-wrap items-center gap-x-2 ${className}`}>
          <span aria-hidden="true" className="font-mono text-12 text-text-muted uppercase">
            Klip
          </span>
          <ul aria-label="Klip" className="flex flex-wrap items-center gap-x-2">
            {shown.map((b, i) => (
              <li key={b.id} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="font-mono text-13 text-text-muted">
                    ·
                  </span>
                )}
                <button
                  type="button"
                  data-set-clip={b.id}
                  aria-label={b.name}
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 font-mono text-13 text-text tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onClick={(e) => {
                    const el = e.currentTarget;
                    play(b.id, el, () => afterDelete(el));
                  }}
                >
                  <span aria-hidden="true">{b.label}</span>
                  <Icon name="play" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** §3: the next ▶ in the row, else the exercise's toggle (Træning) or the session heading (week card). */
function afterDelete(el: HTMLElement): HTMLElement | null {
  const next = el.closest("li")?.nextElementSibling?.querySelector<HTMLElement>("button[data-set-clip]");
  if (next !== null && next !== undefined) return next;
  const fallback = el.closest("[data-clip-scope]")?.querySelector<HTMLElement>("[data-clip-fallback]") ?? null;
  if (fallback !== null && fallback.tabIndex < 0 && !(fallback instanceof HTMLButtonElement)) fallback.setAttribute("tabindex", "-1");
  return fallback;
}
