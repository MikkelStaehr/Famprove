import { FORM_ZONE_DISPLAY } from "@/lib/dashboard-view";
import { BAND_LABEL, BAND_TEXT, PROGNOSE_TEXT } from "@/lib/prognose-text";
import { ZONE_FILL, ZONE_RANGE, type ZoneKey } from "@/lib/zone-scale";

import { BandSwatch, LineSample, PROGNOSE_LABEL, PrognoseSwatch, SERIES, type SeriesKey } from "./ChartSeries";

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
  swatch: ZONE_FILL[key],
  range: ZONE_RANGE[key].visible,
  spoken: ZONE_RANGE[key].spoken,
  text,
}));

export function LoadExplainer() {
  return (
    <details className="group">
      <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 rounded-control text-16 font-semibold text-text">
        <span>
          Hvad betyder det?<span className="sr-only"> Forklaring af fitness, træthed, form og formzoner</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-5 shrink-0 text-text-muted group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-180 motion-safe:ease-out"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </summary>
      <div className="mt-2 flex max-w-[65ch] flex-col gap-4 pb-4">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-3">
            {SERIES.map((s) => (
              <div key={s.key}>
                <dt className="flex items-center gap-2 text-16 font-bold">
                  <LineSample series={s} />
                  {s.label}
                </dt>
                <dd className="mt-1 text-16 text-text">{LINE_TEXT[s.key]}</dd>
              </div>
            ))}
            <div>
              <dt className="flex items-center gap-2 text-16 font-bold">
                <PrognoseSwatch />
                {PROGNOSE_LABEL}
              </dt>
              <dd className="mt-1 text-16 text-text">{PROGNOSE_TEXT}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-16 font-bold">
                <BandSwatch />
                {BAND_LABEL}
              </dt>
              <dd className="mt-1 text-16 text-text">{BAND_TEXT}</dd>
            </div>
          </dl>
          <p className="text-14 text-text-muted">{METHOD_NOTE}</p>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-14 font-bold tracking-[0.04em] uppercase">Formzoner</h3>
          <dl className="flex flex-col gap-3">
            {ZONES.map((z) => (
              <div key={z.key}>
                <dt className="flex flex-wrap items-center gap-x-2">
                  <span
                    aria-hidden="true"
                    className={`size-3 shrink-0 rounded-mark ring-1 ring-text-muted ${z.swatch}`}
                  />
                  <span className="text-16 font-bold">{z.name}</span>
                  <span className="text-14 font-semibold text-text-muted tabular-nums">
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
