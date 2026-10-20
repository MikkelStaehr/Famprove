"use client";

import { useEffect, useRef } from "react";

import type { PartnerRowView } from "@/lib/superset-view";

import { Icon } from "./icons";

/**
 * ⇄'s partner list (superset-any.md §3–§7, §13, R1): a bottom sheet over a native modal <dialog>
 * (focus trap, Escape and focus return to the opener come from showModal). One button per
 * candidate run, "Som sidst" first; the empty state has Luk only. No primary button.
 */
export function PartnerSheet({
  nameA,
  rows,
  devSwitches,
  onPick,
  onClose,
}: {
  readonly nameA: string;
  readonly rows: readonly PartnerRowView[];
  readonly devSwitches: boolean;
  readonly onPick: (row: number) => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d !== null && !d.open) d.showModal();
    // No close() on cleanup: it fires `close` (onClose) under StrictMode's re-run; unmounting removes it from the top layer.
  }, []);
  const titleId = `partner-title-${nameA.replace(/\W+/g, "-")}`;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // the scrim (::backdrop) closes
      }}
      className="partner-sheet fixed inset-x-0 top-auto bottom-0 m-0 mx-auto w-full max-w-[30rem] rounded-t-hero border-t border-border bg-card px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-text"
    >
      <div aria-hidden="true" className="mx-auto h-1 w-9 rounded-[2px] bg-shade-1" />
      <PartnerListBody titleId={titleId} nameA={nameA} rows={rows} devSwitches={devSwitches} onPick={onPick} onClose={onClose} />
    </dialog>
  );
}

function PartnerButton({ row, onPick }: { readonly row: PartnerRowView; readonly onPick: (row: number) => void }) {
  return (
    <button
      type="button"
      aria-label={row.label}
      onClick={() => onPick(row.row)}
      className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:opacity-85"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        {row.lastTime && (
          <span className="flex items-center gap-1.5 font-mono text-11 text-text uppercase">
            <Icon name="history" size={16} />
            Som sidst
          </span>
        )}
        <span className="truncate font-sans text-16 font-medium">{row.name}</span>
        {row.under !== null && <span className="truncate text-13 text-text-muted">{row.under}</span>}
        <span className="font-mono text-12 text-text-muted tabular-nums">{row.meta}</span>
      </span>
      {row.kg !== null && <span className="shrink-0 font-mono text-16 tabular-nums">{row.kg}</span>}
    </button>
  );
}

/**
 * The list's content (superset-any.md §4–7, §13): the title (the dialog's label via `titleId`), the
 * explainer, the I DAG caption and one button per candidate; in Fokus's session sheet it is step 2
 * with a Tilbage button (R1, §3).
 */
export function PartnerListBody({
  titleId,
  nameA,
  rows,
  devSwitches,
  onPick,
  onClose,
  onBack,
}: {
  readonly titleId: string;
  readonly nameA: string;
  readonly rows: readonly PartnerRowView[];
  readonly devSwitches: boolean;
  readonly onPick: (row: number) => void;
  readonly onClose: () => void;
  readonly onBack?: () => void;
}) {
  const first = rows[0];
  const rest = first?.lastTime === true ? rows.slice(1) : rows;
  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        {onBack !== undefined && (
          <button
            type="button"
            aria-label="Tilbage"
            onClick={onBack}
            className="-ml-2.5 flex size-11 items-center justify-center rounded-full text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:opacity-85"
          >
            <Icon name="chevron-left" size={20} />
          </button>
        )}
        <h2 id={titleId} tabIndex={-1} className="min-w-0 flex-1 font-sans text-18 font-semibold">
          Superset med {nameA}
        </h2>
        <button
          type="button"
          aria-label="Luk"
          onClick={onClose}
          className="-mr-2.5 flex size-11 items-center justify-center rounded-full text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:opacity-85"
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="pt-1">
          <p className="text-14 text-text">Ingen øvelser kan tages som superset med {nameA} nu.</p>
          <p className="mt-1 text-13 text-text-muted">De andre øvelser er gået i gang eller allerede i et superset.</p>
        </div>
      ) : (
        <>
          <p className="text-13 text-text-muted">Den du vælger, rykker op lige efter {nameA} og tages uden pause. Kun i dag.</p>
          {devSwitches && <p className="mt-1 text-13 text-text-muted">Testvisning: valget gemmes ikke.</p>}
          <p aria-hidden="true" className="mt-3 text-right font-mono text-11 text-text-muted uppercase">
            I dag
          </p>
          <ul aria-labelledby={titleId} className="max-h-[60vh] overflow-y-auto overscroll-contain">
            {first?.lastTime === true && (
              <li className="mb-2 border-b border-border pb-2">
                <PartnerButton row={first} onPick={onPick} />
              </li>
            )}
            {rest.map((r, i) => (
              <li key={r.row} className={i === 0 ? "" : "border-t border-border"}>
                <PartnerButton row={r} onPick={onPick} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
