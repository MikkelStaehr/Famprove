"use client";

import { type RefObject, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { clock, DENIED_HELP, DENIED_TITLE, WAITING_LABEL } from "@/lib/video/recording";
import { CAPTION, FokusWarning, OUTLINED } from "./Instrument";

/** §1: the 8px disc in --text before Optag (never the ● glyph, never --rec: R2). */
export function RecDisc() {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-text" />;
}

/** §5/§11: the recording dot, a 20px --rec disc pulsing 1 → 0.7 → 1; the one place --rec is used. */
function RecDot() {
  return <span aria-hidden="true" className="rec-pulse inline-block size-5 shrink-0 rounded-full bg-rec" />;
}

/** §1/§7: Optag (dark, 44px, compact) in the hero card's bottom row; Annullér optagelse while recording. */
export function OptagButton({
  live,
  waiting,
  name,
  onOptag,
  onCancel,
}: {
  readonly live: boolean;
  readonly waiting: boolean;
  readonly name: string;
  readonly onOptag: () => void;
  readonly onCancel: () => void;
}) {
  const cls = `inline-flex min-h-11 items-center justify-center gap-2 px-4 ${OUTLINED}`;
  if (live && !waiting) {
    return (
      <button type="button" onClick={onCancel} className={cls}>
        <Icon name="x" size={18} />
        Annullér optagelse
      </button>
    );
  }
  return (
    <button type="button" onClick={onOptag} aria-label={waiting ? WAITING_LABEL : name} aria-disabled={waiting} className={cls}>
      {!waiting && <RecDisc />}
      {waiting ? WAITING_LABEL : "Optag"}
    </button>
  );
}

/** §13: the blocked camera's line under the hero card's bottom row. */
export function DeniedLine() {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <FokusWarning>{DENIED_TITLE}</FokusWarning>
      <p className="font-sans text-13 text-text-muted">{DENIED_HELP}</p>
    </div>
  );
}

/**
 * §5–§6: the recording strip in the rest strip's slot (Card 22, padding 16): OPTAGER ↔ SÆT n · UDEN
 * LYD, the running time, and the live preview (88 × 128, contain, not mirrored) as a button that
 * lays it over the hero card at full card width.
 */
export function RecordStrip({
  setNo,
  elapsed,
  previewRef,
  fixture,
}: {
  readonly setNo: number;
  readonly elapsed: number;
  readonly previewRef: RefObject<HTMLVideoElement | null>;
  readonly fixture: boolean;
}) {
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBig(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);
  const preview = fixture ? (
    <span className="flex size-full items-center justify-center bg-track font-mono text-11 text-text-muted">Testvisning</span>
  ) : (
    <video ref={previewRef} muted playsInline autoPlay aria-hidden="true" className="size-full bg-bg object-contain" />
  );
  return (
    // acceptance 2: --h-fokus-strip is the rest card's min-height too, so the hero card under it stays
    // put when recording starts. §5: the left column is 12px from the preview.
    <section aria-label="Optagelse" className="relative flex min-h-(--h-fokus-strip) items-stretch justify-between gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-13 text-text uppercase">Optager</span>
          <span className={CAPTION}>{`Sæt ${setNo} · uden lyd`}</span>
        </p>
        {/* `● 0:12` at the column's bottom, readable at 3 m (DESIGN.md Recording counter). */}
        <p aria-hidden="true" className="mt-auto flex items-center gap-2 pt-2">
          <RecDot />
          <span className="rec-counter">{clock(elapsed)}</span>
        </p>
      </div>
      <button
        type="button"
        aria-label={big ? "Vis kameraet lille" : "Vis kameraet stort"}
        aria-pressed={big}
        onClick={() => setBig((b) => !b)}
        className={
          big
            ? "rec-grow absolute inset-x-0 top-full z-20 mt-3 aspect-[9/16] max-h-[60vh] w-full overflow-hidden rounded-hero border border-border bg-bg"
            : "h-32 w-22 shrink-0 overflow-hidden rounded-[10px] border border-border bg-bg"
        }
      >
        {preview}
      </button>
    </section>
  );
}

export { clock };
