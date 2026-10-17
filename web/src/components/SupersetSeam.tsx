"use client";

import { refusedText, type SeamSave, type SeamView, seamPaired } from "@/lib/superset-view";

import { OUTLINED } from "./fokus/Instrument";
import { Icon } from "./icons";
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
}: {
  readonly v: SeamView;
  readonly save: SeamSave | undefined;
  readonly onToggle: (paired: boolean) => void;
}) {
  const on = seamPaired(v.state);
  return (
    <div className="flex flex-col pb-1">
      {v.state !== "none" && (
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
      {save?.status === "failed" && (
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

