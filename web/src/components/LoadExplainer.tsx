import { FORM_ZONE_DISPLAY } from "@/lib/dashboard-view";
import { BAND_LABEL, BAND_TEXT, PROGNOSE_TEXT } from "@/lib/prognose-text";
import { BANDS, ZONE_RANGE, type ZoneKey } from "@/lib/zone-scale";

import { BandSwatch, LineSample, PROGNOSE_LABEL, PrognoseSwatch, SERIES, type SeriesKey } from "./ChartSeries";
import { Icon } from "./icons";

/**
 * "Hvad betyder det?" (design/specs/load.md §8b): a native <details> in the chart card, under
 * the legend. Closed by default; the browser exposes expanded/collapsed, so no JS or ARIA here.
 */

const LINE_TEXT: Readonly<Record<SeriesKey, string>> = {
  ctl: "Din gennemsnitlige daglige belastning over de sidste ca. 6 uger. Stiger langsomt og viser den kapacitet, du har bygget op.",
  atl: "Din gennemsnitlige daglige belastning over den sidste ca. uge. Svinger hurtigt og viser, hvor træt du er lige nu.",
  tsb: "Fitness minus træthed. Negativ: du bygger op og er træt. Positiv: du er frisk.",
};

const METHOD_NOTE =
  "Belastning er TSS pr. dag fra cykling og styrke tilsammen. Fitness og træthed er vægtede gennemsnit: de nyeste dage tæller mest, og ældre dage fylder gradvist mindre uden at forsvinde helt. Tidskonstanterne er 42 og 7 dage, samme formel som intervals.icu.";

/** What each zone means for training (spec load.md §8b); names, swatches and ranges come from their owners. */
const ZONE_TEXT: readonly (readonly [ZoneKey, string])[] = [
  ["high_risk", "Træthed langt over fitness. Risiko for overbelastning og sygdom, så læg lette dage ind."],
  ["optimal", "Træt nok til at bygge fitness uden at køre dig selv ned. Her skal en god træningsblok ligge."],
  ["grey_zone", "Hverken træt nok til at bygge fitness eller frisk nok til at præstere."],
  ["fresh", "Udhvilet og klar til at præstere, fx til løb eller test. Fitness bygges ikke op."],
  ["transition", "Så frisk, at fitness falder. Fint i en pause mellem sæsoner, ellers er det tid til at træne mere."],
];

/** Scale order, low to high. */
const ZONES = ZONE_TEXT.map(([key, text]) => ({
  key,
  name: FORM_ZONE_DISPLAY[key]?.label ?? key,
  span: BANDS.find((b) => b.key === key) ?? null,
  range: ZONE_RANGE[key].visible,
  spoken: ZONE_RANGE[key].spoken,
  text,
}));

export function LoadExplainer() {
  return (
    <details className="group">
      <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 text-16 font-medium text-text">
        <span>
          Hvad betyder det?<span className="sr-only"> Forklaring af fitness, træthed, form og formzoner</span>
        </span>
        <Icon
          name="chevron-down"
          size={20}
          className="text-text-muted group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-180 motion-safe:ease-out"
        />
      </summary>
      <div className="mt-2 flex max-w-[65ch] flex-col gap-4 pb-4">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-3">
            {SERIES.map((s) => (
              <div key={s.key}>
                <dt className="flex items-center gap-2 text-16 font-medium">
                  <LineSample series={s} />
                  {s.label}
                </dt>
                <dd className="mt-1 text-16 text-text">{LINE_TEXT[s.key]}</dd>
              </div>
            ))}
            <div>
              <dt className="flex items-center gap-2 text-16 font-medium">
                <PrognoseSwatch />
                {PROGNOSE_LABEL}
              </dt>
              <dd className="mt-1 text-16 text-text">{PROGNOSE_TEXT}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-16 font-medium">
                <BandSwatch />
                {BAND_LABEL}
              </dt>
              <dd className="mt-1 text-16 text-text">{BAND_TEXT}</dd>
            </div>
          </dl>
          <p className="text-14 text-text-muted">{METHOD_NOTE}</p>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="caption">Formzoner</h3>
          <dl className="flex flex-col gap-3">
            {ZONES.map((z) => (
              <div key={z.key}>
                <dt className="flex flex-wrap items-center gap-x-2">
                  <ZoneSpanSwatch span={z.span} />
                  <span className="text-16 font-medium">{z.name}</span>
                  <span className="font-mono text-14 text-text-muted">
                    <span aria-hidden="true">{z.range}</span>
                    <span className="sr-only">{z.spoken}</span>
                  </span>
                </dt>
                <dd className="mt-1 text-16 text-text">{z.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </details>
  );
}

/**
 * The zone's span on a miniature of the hero's zone ruler (instrument-load.md §2): a 1px muted
 * baseline with the zone drawn as the 3px ink bar. No colour; the name beside it says which zone.
 */
function ZoneSpanSwatch({ span }: { readonly span: { readonly start: number; readonly end: number } | null }) {
  const w = 32;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${w} 12`} className="h-3 w-8 shrink-0">
      <line x1="0" x2={w} y1="8.5" y2="8.5" stroke="var(--text-muted)" strokeWidth="1" />
      {span !== null && <rect x={span.start * w} y="6" width={(span.end - span.start) * w} height="3" fill="var(--text)" />}
    </svg>
  );
}
