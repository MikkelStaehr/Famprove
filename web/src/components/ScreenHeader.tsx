import type { ReactNode } from "react";

type ScreenHeaderProps = {
  /** The page h1, Geist 22/600. */
  readonly title: ReactNode;
  /** The Geist Mono text-12 muted line under it: `ons. 14. okt. · opdateret kl. 05.00`. */
  readonly line?: ReactNode;
  /** Under the line: stale WarningLine, notices, section tabs. */
  readonly children?: ReactNode;
  readonly className?: string;
};

/** The screen header (mockup A): h1 + mono date/updated line, gap 2px, padding 4px 4px 8px. No gear button (DESIGN.md Don'ts). */
export function ScreenHeader({ title, line, children, className }: ScreenHeaderProps) {
  return (
    <header className={`flex flex-col gap-2 px-1 pt-1 pb-2${className === undefined ? "" : ` ${className}`}`}>
      <div className="flex flex-col gap-0.5">
        <h1 className="font-sans text-22 font-semibold text-text">{title}</h1>
        {line === undefined ? null : <p className="font-mono text-12 text-text-muted">{line}</p>}
      </div>
      {children}
    </header>
  );
}
