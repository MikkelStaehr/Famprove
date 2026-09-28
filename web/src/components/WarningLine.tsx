import type { ReactNode } from "react";

/** A text-14 line in --warning with a triangle: the words carry the meaning, never colour alone. */
export function WarningLine({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-14 text-warning">
      <span className="flex h-lh shrink-0 items-center">
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="currentColor">
          <path d="M6 1 11 11H1Z" />
        </svg>
      </span>
      <span>{children}</span>
    </p>
  );
}
