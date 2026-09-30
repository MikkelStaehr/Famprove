import { formatLoad, formatSigned } from "@/lib/format";

/**
 * The chart's three series and their stroke sample, shared by TrendChart (client) and the
 * /load explainer (server). No hooks, no "use client": it renders in either.
 */
export type SeriesKey = "ctl" | "atl" | "tsb";

export type Series = {
  readonly key: SeriesKey;
  readonly label: string;
  readonly color: string;
  readonly dash: string | undefined; // stroke pattern: lines never differ by colour alone
  readonly width: number;
  readonly format: (value: number) => string;
};

/** Legend and tooltip order. Part B: CTL ink solid 2.5px, ATL dashed 2px (6 4), TSB dotted 2px (round caps). */
export const SERIES: readonly Series[] = [
  { key: "ctl", label: "Fitness (CTL)", color: "var(--series-ctl)", dash: undefined, width: 2.5, format: formatLoad },
  { key: "atl", label: "Træthed (ATL)", color: "var(--series-atl)", dash: "6 4", width: 2, format: formatLoad },
  { key: "tsb", label: "Form (TSB)", color: "var(--series-tsb)", dash: "0.5 4", width: 2, format: formatSigned },
];

/** Stroke sample in the series' colour and dash pattern, 24px wide (decorative; the label names it). */
export function LineSample({ series }: { readonly series: Series }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className="h-3 w-6 shrink-0">
      <line
        x1="2"
        y1="6"
        x2="22"
        y2="6"
        stroke={series.color}
        strokeWidth={series.width}
        strokeDasharray={series.dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Legend / explainer name of the prognose region (load.md §9b). */
export const PROGNOSE_LABEL = "Prognose (anslået)";

/** The prognose region's swatch: --track at 60% with a 1px --chart-mark ring, 24×12 (decorative). */
export function PrognoseSwatch() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className="h-3 w-6 shrink-0">
      <rect x="0.5" y="0.5" width="23" height="11" fill="var(--track)" fillOpacity={0.6} stroke="var(--chart-mark)" />
    </svg>
  );
}
