import type { ReactNode } from "react";

import { Icon } from "./icons";

/** The ◆ glyph as inline SVG (Chivo Mono / Inter's latin subset has no ◆), in currentColor. */
export function DiamondIcon({ className = "size-3" }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`shrink-0 ${className}`} fill="currentColor">
      <path d="M8 1 15 8 8 15 1 8Z" />
    </svg>
  );
}

/** DESIGN.md Part B WarningLine: the 16px warning icon in --warning + a Geist text-13 --text sentence, gap 8px. Never colour alone. */
export function WarningLine({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 font-sans text-13 text-text">
      <span className="flex h-lh shrink-0 items-center text-warning">
        <Icon name="warning" size={16} />
      </span>
      <span>{children}</span>
    </p>
  );
}
