import { MARKS } from "@/lib/chart-marks";
import { formatLoad, formatSigned } from "@/lib/format";

import { CombSwatch, HollowDotSwatch, LineSwatch, NeedleSwatch } from "./ChartMarks";

/**
 * The load chart's three series and their stroke sample, used by the /load explainer (server).
 * No hooks, no "use client": it renders in either.
 */
export type SeriesKey = "ctl" | "atl" | "tsb";

export type Series = {
  readonly key: SeriesKey;
  readonly label: string;
  readonly short: string; // the readout cell's label (DESIGN.md "Charts: interaction")
  readonly color: string;
  /** Mark form (Revision 5, user 2026-10-14): CTL/ATL a 1px line, TSB a vertical needle per day from 0. */
  readonly form: "line" | "needle";
  /** Line / needle width in px (lib/chart-marks.ts): told apart by dash and form, never colour. */
  readonly width: number;
  /** ATL's dash; CTL and TSB are solid (the TSB prognose needle is dashed, see MARKS.tsb). */
  readonly dash: string | undefined;
  readonly format: (value: number) => string;
};

/** Legend and tooltip order. Revision 5: all ink; CTL 1px line, ATL 1px dashed line, TSB 1px needle. */
export const SERIES: readonly Series[] = [
  { key: "ctl", label: "Fitness (CTL)", short: "Fitness", color: MARKS.ctl.color, form: "line", width: MARKS.ctl.width, dash: MARKS.ctl.dash, format: formatLoad },
  { key: "atl", label: "Træthed (ATL)", short: "Træthed", color: MARKS.atl.color, form: "line", width: MARKS.atl.width, dash: MARKS.atl.dash, format: formatLoad },
  { key: "tsb", label: "Form (TSB)", short: "Form", color: MARKS.tsb.color, form: "needle", width: MARKS.tsb.width, dash: undefined, format: formatSigned },
];

/** The series' mark as its legend / readout swatch, 24×12 (decorative; the label names it). */
export function SeriesSwatch({ series }: { readonly series: Series }) {
  return series.form === "needle" ? <NeedleSwatch /> : <LineSwatch dash={series.dash} />;
}

/** Former name of SeriesSwatch (LoadExplainer); same mark-form swatch. */
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
