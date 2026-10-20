"use client";

import { useRef, useState } from "react";

import { type PartnerRowView, refusedText, type SeamSave, type SeamView, seamPaired } from "@/lib/superset-view";

import { OUTLINED } from "./fokus/Instrument";
import { Icon } from "./icons";
import { PartnerSheet } from "./PartnerSheet";
import type { PickProblem } from "./usePartnerPick";
import { SECONDARY } from "./instrument";
import { WarningLine } from "./WarningLine";

/**
 * The seam between two runs (supersets.md S1–S3, S7–S9): hairlines left and right, the control
 * centred. A dark compact toggle (32px visible, 44px hit via ::before), or the static locked text.
 */
export function SupersetSeam({
  v,
  save,
  onToggle,
  partners = null,
  onPick,
  picked = false,
  problem = null,
  onRetry,
  devSwitches = false,
  initialOpen = null,
  onOpenList,
}: {
  readonly v: SeamView;
  readonly save: SeamSave | undefined;
  readonly onToggle: (paired: boolean) => void;
  /** superset-any.md §1–2: ⇄'s partner list for A (unpaired seams); null = the old toggle. */
  readonly partners?: readonly PartnerRowView[] | null;
  readonly onPick?: (row: number) => void;
  /** The slot a pick made: its failed line is §11's. */
  readonly picked?: boolean;
  /** §11–12: a failed (Gem igen) or refused pick's line. */
  readonly problem?: PickProblem | null;
  readonly onRetry?: () => void;
  readonly devSwitches?: boolean;
  /** DEV fixtures superset-pick / -empty: the list open at load ("empty": without candidates). */
  readonly initialOpen?: "open" | "empty" | null;
  /** Fokus's session sheet: the list opens as the sheet's step 2 (R1), not as a sheet of its own. */
  readonly onOpenList?: () => void;
}) {
  const on = seamPaired(v.state);
  const [open, setOpen] = useState(initialOpen !== null && partners !== null);
  const opener = useRef<HTMLButtonElement>(null);
  const lists = partners !== null && onPick !== undefined && !on;
  return (
    <div className="flex flex-col pb-1">
      {lists && (
        <div data-seam="pick" className="flex min-h-11 items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          <button
            ref={opener}
            type="button"
            aria-haspopup="dialog"
            aria-label={`Vælg superset til ${v.nameA}`}
            onClick={() => (onOpenList === undefined ? setOpen(true) : onOpenList())}
            className={`relative inline-flex h-8 shrink-0 items-center gap-2 px-3 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${OUTLINED}`}
          >
            <Icon name="arrow-left-right" size={18} />
            Superset
          </button>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
      )}
      {open && onPick !== undefined && (
        // §13: candidates that vanish while it is open leave the sheet open with the empty state.
        <PartnerSheet
          nameA={v.nameA}
          rows={initialOpen === "empty" ? [] : (partners ?? [])}
          devSwitches={devSwitches}
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
          onPick={(row) => {
            setOpen(false);
            onPick(row);
          }}
        />
      )}
      {!lists && v.state !== "none" && (
        <div data-seam={v.state} className="flex min-h-11 items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          {v.state === "locked" ? (
            <p className="flex items-center gap-2 font-mono text-13 text-text-muted uppercase">
              <Icon name="arrow-left-right" size={18} />
              <span aria-hidden="true">Superset · låst</span>
              <span className="sr-only">Superset, låst, fordi {v.started} er gået i gang.</span>
            </p>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`Superset: ${v.both}`}
                onClick={() => onToggle(!on)}
                className={`relative inline-flex h-8 shrink-0 items-center gap-2 px-3 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${OUTLINED.replace("bg-card", on ? "bg-raised" : "bg-card")}`}
              >
                <Icon name={on ? "check" : "arrow-left-right"} size={18} />
                Superset
              </button>
              {v.state === "suggested" && <span className="shrink-0 font-sans text-13 text-text-muted">Som sidst</span>}
            </>
          )}
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
      )}
      {problem !== null && (
        <WarningLine>
          {problem.text}
          {problem.sub !== null && ` ${problem.sub}`}
          {problem.kind === "failed" && onRetry !== undefined && (
            <button type="button" onClick={onRetry} className={`mt-2 flex ${SECONDARY}`}>
              Gem igen
            </button>
          )}
        </WarningLine>
      )}
      {save?.status === "failed" && !picked && (
        <WarningLine>
          Superset-valget er ikke gemt. Det står her, men forsvinder, hvis siden genindlæses.{" "}
          <button type="button" onClick={() => onToggle(save.override ?? on)} className={`mt-2 flex ${SECONDARY}`}>
            Gem igen
          </button>
        </WarningLine>
      )}
      {save?.status === "refused" && <WarningLine>{refusedText(v, save.reason)}</WarningLine>}
    </div>
  );
}

