import type { Metadata } from "next";

import { MarkChart, WeekStrips } from "@/components/AnalyseCharts";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { UpdatedLine } from "@/components/UpdatedLine";
import {
  type AnalyseView,
  buildAnalyseView,
  type Direction,
} from "@/lib/analyse-view";
import {
  type DataError,
  describeDataError,
  isDataError,
} from "@/lib/data-error";
import { loadCyclingAnalysis } from "@/lib/db/queries";
import { formatUpdatedAt } from "@/lib/format";
import { resolveToday } from "@/lib/today-view";

export const metadata: Metadata = { title: "Analyse" };

type Ready = Extract<AnalyseView, { kind: "ready" }>;
type PageState =
  | AnalyseView
  | { readonly kind: "error"; readonly error: DataError; readonly at: Date };

const HONESTY =
  "eFTP er et skøn fra intervals.icu ud fra dine hårdeste indsatser, ikke et testresultat. Uden maksimale indsatser ligger den ofte for lavt.";
const EF_EXPLAINER =
  "EF er normaliseret watt (NP) delt med gennemsnitspuls. Stiger den, træder du flere watt for samme puls. Kun rolige ture på mindst 30 min med både watt og puls.";

async function loadPageState(): Promise<PageState> {
  try {
    const data = await loadCyclingAnalysis();
    const now = new Date();
    return buildAnalyseView(data, now, resolveToday(now, process.env));
  } catch (error) {
    if (isDataError(error)) {
      console.error("analyse: loading data failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

export default async function Page() {
  const state = await loadPageState();
  return (
    <>
      <header className="flex flex-col">
        <h1 className="font-display text-44 font-extrabold tracking-[-0.01em] uppercase italic">
          Analyse
        </h1>
        {state.kind === "ready" && (
          <div className="mt-1">
            <UpdatedLine
              freshness={state.freshness}
              staleNote="Jobbet skal køre dagligt omkring kl. 05.00."
              unknownNote="Opdateringstidspunkt ukendt, så data kan være forældet."
            />
          </div>
        )}
        <h2 className="mt-4 font-display text-32 leading-none font-extrabold uppercase italic">
          Cykel
        </h2>
        {state.kind === "ready" && <Hero view={state} />}
      </header>
      {state.kind === "error" && (
        <ErrorState
          title="Kunne ikke hente cykeldata"
          what={describeDataError(state.error)}
          detail={state.error.message}
          at={{
            iso: state.at.toISOString(),
            text: formatUpdatedAt(state.at.toISOString()),
          }}
          retry={{ href: "/analyse" }}
        />
      )}
      {state.kind === "empty" && (
        <EmptyState message="Der er ingen cykelture siden 1. jan. 2025 endnu. Det daglige job henter dem omkring kl. 05.00." />
      )}
      {state.kind === "ready" && <Cards view={state} />}
    </>
  );
}

function Hero({ view }: { readonly view: Ready }) {
  const { hero } = view;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-14 font-bold tracking-[0.04em] uppercase">
          Estimeret FTP
        </p>
        {hero.kind === "eftp" && (
          <p className="text-14 font-semibold text-text">{hero.dateText}</p>
        )}
      </div>
      {hero.kind === "none" ? (
        <p className="mt-2 text-16 text-text-muted">{hero.text}</p>
      ) : (
        <>
          <p className="sr-only">{hero.sr}</p>
          <div aria-hidden="true">
            <p className="mt-2 font-display text-56 leading-none font-extrabold italic tabular-nums">
              {hero.value}
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-16 font-semibold">
              {hero.delta.direction !== null && (
                <DirectionIcon direction={hero.delta.direction} />
              )}
              {hero.delta.text}
            </p>
            {hero.detail !== null && (
              <p className="mt-1 text-14 text-text-muted tabular-nums">
                {hero.detail}
              </p>
            )}
          </div>
        </>
      )}
      <p className="mt-2 max-w-[60ch] text-14 text-text-muted">{HONESTY}</p>
    </div>
  );
}

function DirectionIcon({ direction }: { readonly direction: Direction }) {
  const d =
    direction === "up"
      ? "M8 3v10M4 7l4-4 4 4"
      : direction === "down"
        ? "M8 13V3M4 9l4 4 4-4"
        : "M3 8h10M9 4l4 4-4 4";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const axisOf = (v: Ready) => ({
  lo: v.lo,
  hi: v.hi,
  ticksNarrow: v.ticksNarrow,
  ticksWide: v.ticksWide,
  seams: v.seams,
});

function Cards({ view }: { readonly view: Ready }) {
  const axis = axisOf(view);
  return (
    <>
      <Card id="eftp" variant="calm" level={3} title="eFTP pr. tur">
        {view.eftp === null ? (
          <EmptyState message="Trenden vises, når der er mindst to ture med watt." />
        ) : (
          <figure className="flex flex-col gap-2">
            <Legend
              items={[
                { swatch: <LineDot />, label: "eFTP" },
                { swatch: <Hollow />, label: "Udeladt tur" },
              ]}
            />
            <p
              className="text-12 font-medium text-text-muted"
              aria-hidden="true"
            >
              W
            </p>
            <MarkChart
              axis={axis}
              chart={view.eftp}
              title="eFTP pr. tur"
              variant="eftp"
            />
            {view.noWattNote !== null && (
              <p className="max-w-[60ch] text-14 text-text-muted">
                {view.noWattNote}
              </p>
            )}
            <figcaption className="sr-only">{view.eftp.sr}</figcaption>
          </figure>
        )}
      </Card>

      <Card
        id="ef"
        variant="calm"
        level={3}
        title="Effektivitet på rolige ture"
      >
        <p className="max-w-[60ch] text-14 text-text-muted">{EF_EXPLAINER}</p>
        {"kind" in view.ef ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-16 font-semibold">
              For få rolige ture til en trend
            </h4>
            <p className="max-w-[60ch] text-14 text-text-muted">
              {view.ef.text}
            </p>
            {view.ef.list.length > 0 && (
              <ul className="flex flex-col gap-1 text-16 tabular-nums">
                {view.ef.list.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <figure className="flex flex-col gap-2">
            <Legend
              items={[
                {
                  swatch: <LineDot line />,
                  label: "Trend (median over 28 dage)",
                },
                { swatch: <MarkDot />, label: "Tur" },
                { swatch: <Hollow />, label: "Udeladt tur" },
              ]}
            />
            <p
              className="text-12 font-medium text-text-muted"
              aria-hidden="true"
            >
              EF (W pr. slag/min)
            </p>
            <MarkChart
              axis={axis}
              chart={view.ef}
              title="Effektivitet på rolige ture"
              variant="ef"
            />
            <figcaption className="sr-only">{view.ef.sr}</figcaption>
          </figure>
        )}
      </Card>

      <Card
        id="weeks"
        variant="calm"
        level={3}
        title="Timer og belastning pr. uge"
      >
        {view.weeks === null ? (
          <ErrorState
            title="Kunne ikke hente ugerne"
            what={
              view.weeksError === null
                ? "Læsning af cycling_weeks fra databasen mislykkedes."
                : describeDataError(view.weeksError)
            }
            detail={view.weeksError?.message}
            retry={{ href: "/analyse" }}
          />
        ) : (
          <figure className="flex flex-col gap-2">
            <Legend
              items={[
                {
                  swatch: <Bar className="bg-text-muted" />,
                  label: "Uge med ture",
                },
                { swatch: <Bar className="bg-slab" />, label: "Denne uge" },
                { swatch: <ZeroTick />, label: "Uge uden ture" },
              ]}
            />
            <WeekStrips axis={axis} weeks={view.weeks} max={view.weekMax} />
            <div className="sr-only">
              <table>
                <caption>Cykling pr. uge</caption>
                <thead>
                  <tr>
                    <th scope="col">Uge</th>
                    <th scope="col">Ture</th>
                    <th scope="col">Timer</th>
                    <th scope="col">Belastning (TSS)</th>
                    <th scope="col">Udeladt fra trends</th>
                  </tr>
                </thead>
                <tbody>
                  {view.weeks.map((w) => (
                    <tr key={w.x0}>
                      {w.srRow.map((c, i) =>
                        i === 0 ? (
                          <th key={i} scope="row">
                            {c}
                          </th>
                        ) : (
                          <td key={i}>{c}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </figure>
        )}
      </Card>

      <Excluded view={view} />
    </>
  );
}

function Excluded({ view }: { readonly view: Ready }) {
  if (view.excluded === null)
    return (
      <p className="text-14 text-text-muted">Ingen ture udeladt fra trends.</p>
    );
  return (
    <section
      aria-label="Udeladte ture"
      className="rounded-card bg-surface px-4 py-2 shadow-card"
    >
      <details className="group">
        <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-2 rounded-control text-16 font-semibold text-text focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus">
          {view.excluded.summary}
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
        <div className="mt-2 flex flex-col gap-3 pb-3">
          <p className="text-14 text-text-muted">
            De tæller stadig med i timer og belastning.
          </p>
          <ul className="flex flex-col gap-3">
            {view.excluded.items.map((it) => (
              <li key={it.key}>
                <p className="text-16 font-semibold">{it.title}</p>
                {it.explanation !== null && (
                  <p className="text-14 text-text">{it.explanation}</p>
                )}
                {it.facts !== "" && (
                  <p className="text-14 text-text-muted tabular-nums">
                    {it.facts}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

function Legend({
  items,
}: {
  readonly items: readonly {
    readonly swatch: React.ReactNode;
    readonly label: string;
  }[];
}) {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-14 text-text"
      aria-label="Forklaring"
    >
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function LineDot({ line = true }: { readonly line?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className="h-3 w-6 shrink-0">
      {line && (
        <line
          x1="2"
          y1="6"
          x2="22"
          y2="6"
          stroke="var(--text)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      )}
      <circle cx="12" cy="6" r="2.5" fill="var(--text)" />
    </svg>
  );
}

function MarkDot() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0">
      <circle cx="6" cy="6" r="3" fill="var(--chart-mark)" />
    </svg>
  );
}

function Hollow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0">
      <circle
        cx="6"
        cy="6"
        r="3.5"
        fill="var(--surface)"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Bar({ className }: { readonly className: string }) {
  return (
    <span aria-hidden="true" className={`h-3 w-2 shrink-0 ${className}`} />
  );
}

function ZeroTick() {
  return (
    <span
      aria-hidden="true"
      className="mt-2.5 h-0.5 w-2 shrink-0 bg-chart-mark"
    />
  );
}
