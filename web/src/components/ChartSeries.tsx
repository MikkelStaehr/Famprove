import { MARKS } from "@/lib/chart-marks";
import { formatLoad, formatSigned } from "@/lib/format";

import { CombSwatch, HollowDotSwatch, NeedleSwatch, TickSwatch } from "./ChartMarks";

/**
 * The chart's three series and their stroke sample, shared by TrendChart (client) and the
 * /load explainer (server). No hooks, no "use client": it renders in either.
 */
export type SeriesKey = "ctl" | "atl" | "tsb";

export type Series = {
  readonly key: SeriesKey;
  readonly label: string;
  readonly short: string; // the readout cell's label (DESIGN.md "Charts: interaction")
  readonly color: string;
  /** Mark form (Revision 5): CTL/ATL a horizontal day tick, TSB a vertical needle from 0. */
  readonly form: "tick" | "needle";
  /** Tick thickness / needle width in px (lib/chart-marks.ts): told apart by weight and form, never colour. */
  readonly width: number;
  /** Kept for the transition only: no series is dashed in Revision 5 (the TSB prognose needle is, see MARKS.tsb). */
  readonly dash: string | undefined;
  readonly format: (value: number) => string;
};

/** Legend and tooltip order. Revision 5: all ink; CTL 3px tick, ATL 1.5px tick, TSB 1px needle. */
export const SERIES: readonly Series[] = [
  { key: "ctl", label: "Fitness (CTL)", short: "Fitness", color: MARKS.ctl.color, form: "tick", width: MARKS.ctl.thickness, dash: undefined, format: formatLoad },
  { key: "atl", label: "Træthed (ATL)", short: "Træthed", color: MARKS.atl.color, form: "tick", width: MARKS.atl.thickness, dash: undefined, format: formatLoad },
  { key: "tsb", label: "Form (TSB)", short: "Form", color: MARKS.tsb.color, form: "needle", width: MARKS.tsb.width, dash: undefined, format: formatSigned },
];

/** The series' mark as its legend / readout swatch, 24×12 (decorative; the label names it). */
export function SeriesSwatch({ series }: { readonly series: Series }) {
  return series.form === "needle" ? <NeedleSwatch /> : <TickSwatch thickness={series.width} />;
}

/** Former name of SeriesSwatch (TrendChart, LoadExplainer); same mark-form swatch. */
export const LineSample = SeriesSwatch;

/** Legend / explainer name of the prognose region (load.md §9b). */
export const PROGNOSE_LABEL = "Prognose (anslået)";

/** The prognose swatch: hollow dots (estimated = hollow, Revision 5). */
export function PrognoseSwatch() {
  return <HollowDotSwatch />;
}

/** The CTL band's swatch (load.md §10a): the range comb. */
export function BandSwatch() {
  return <CombSwatch />;
}
