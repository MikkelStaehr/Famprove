import type { ZoneKey } from "@/lib/zone-scale";

import { LineSample, SERIES, type SeriesKey } from "./ChartSeries";

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

type ZoneItem = {
  readonly key: ZoneKey;
  readonly name: string;
  readonly swatch: string; // Tailwind bg-* utility for the --zone-* token
  readonly range: string; // visible, U+2212 minus
  readonly spoken: string; // sr-only twin, "minus" written out
  readonly text: string;
};

/** Scale order, low to high. Boundaries as form.py: −30 and −10 belong low, 5 and 20 high. */
const ZONES: readonly ZoneItem[] = [
  {
    key: "high_risk",
    name: "Høj risiko",
    swatch: "bg-zone-risk",
    range: "−30 og lavere",
    spoken: "minus 30 og lavere",
    text: "Træthed langt over fitness. Risiko for overbelastning og sygdom, så læg lette dage ind.",
  },
  {
    key: "optimal",
    name: "Optimal",
    swatch: "bg-zone-optimal",
    range: "over −30 til og med −10",
    spoken: "over minus 30 til og med minus 10",
    text: "Træt nok til at bygge fitness uden at køre dig selv ned. Her skal en god træningsblok ligge.",
  },
  {
    key: "grey_zone",
    name: "Gråzone",
    swatch: "bg-zone-grey",
    range: "over −10 til under 5",
    spoken: "over minus 10 til under 5",
    text: "Hverken træt nok til at bygge fitness eller frisk nok til at præstere.",
  },
  {
    key: "fresh",
    name: "Frisk",
    swatch: "bg-zone-fresh",
    range: "5 til under 20",
    spoken: "5 til under 20",
    text: "Udhvilet og klar til at præstere, fx til løb eller test. Fitness bygges ikke op.",
  },
  {
    key: "transition",
    name: "Overgang",
    swatch: "bg-zone-transition",
    range: "20 og højere",
    spoken: "20 og højere",
    text: "Så frisk, at fitness falder. Fint i en pause mellem sæsoner, ellers er det tid til at træne mere.",
  },
];

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
