import type { ReactNode } from "react";

/** Instrument parts shared by the Fokus views (DESIGN.md Part B, design/specs/fokus-instrument.md). */

/** The view's one filled accent (Part B single-accent table): mono 500 24px label on --accent. */
export const PRIMARY_FILL =
  "flex min-h-16 w-full items-center justify-center gap-3 bg-accent px-4 font-mono text-24 font-medium tracking-[0.08em] text-on-accent uppercase active:brightness-90";
/** An outlined control ([A5]): 1px --text-muted, mono 500. */
export const OUTLINED = "border border-text-muted font-mono text-16 font-medium text-text";
/** An ink text action (Afslut, Fortryd, Hele noten): mono 500, underlined 1px at 4px. */
export const INK_LINK = "min-h-11 font-mono text-16 font-medium text-text underline decoration-1 underline-offset-4";

/** A 1px divider in --border (never an outline, [A5]). */
export function Hairline({ className = "" }: { readonly className?: string }) {
  return <hr aria-hidden="true" className={`h-px border-0 bg-border ${className}`} />;
}

export function CheckIcon({ className }: { readonly className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/** Stale / save-failed line (§6): an ink ◆ (SVG) and the words, never red. */
export function FokusWarning({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-16 text-text">
      <span className="flex h-lh shrink-0 items-center">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
          <path d="M8 1 15 8 8 15 1 8Z" />
        </svg>
      </span>
      <span>{children}</span>
    </p>
  );
}
