import type { ReactNode } from "react";

type TileProps = {
  /** The MonoCaption label, written as a label (shown uppercase): `Træthed`, `Uge 42`. */
  readonly label: ReactNode;
  /** The value: Geist Mono text-24 500. A missing value is `–` (never 0); the caller words its sr text. */
  readonly value: ReactNode;
  /** One supporting line. */
  readonly support?: ReactNode;
  readonly className?: string;
};

/** DESIGN.md Tile: --card, 1px --border, --radius-tile, padding 14px, gap 6px. */
export function Tile({ label, value, support, className }: TileProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-tile border border-border bg-card p-3.5${className === undefined ? "" : ` ${className}`}`}>
      <span className="font-mono text-11 text-text-muted uppercase">{label}</span>
      <span className="font-mono text-24 font-medium text-text tabular-nums">{value}</span>
      {support === undefined ? null : (
        <span className="font-mono text-11 text-text-muted tabular-nums">{support}</span>
      )}
    </div>
  );
}
