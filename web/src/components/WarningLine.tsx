import type { ReactNode } from "react";

/** The ◆ glyph as inline SVG (Chivo Mono / Inter's latin subset has no ◆), in currentColor. */
export function DiamondIcon({ className = "size-3" }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`shrink-0 ${className}`} fill="currentColor">
      <path d="M8 1 15 8 8 15 1 8Z" />
    </svg>
  );
}

/** A text-14 warning line: an ink ◆ and the words in --text (Revision 5, [A1]); never red, never colour alone. */
export function WarningLine({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-14 text-text">
      <span className="flex h-lh shrink-0 items-center">
        <DiamondIcon />
      </span>
      <span>{children}</span>
    </p>
  );
}
