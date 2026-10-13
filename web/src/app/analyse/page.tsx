import type { Metadata } from "next";

import { MarkChart, WeekStrips } from "@/components/AnalyseCharts";
import { AnalyseTabs } from "@/components/AnalyseTabs";
import { AnswerBlocks } from "@/components/AnswerBlock";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { UpdatedLine } from "@/components/UpdatedLine";
import { type AnswersView, buildAnswers } from "@/lib/analyse-answers";
import { type AnalyseView, buildAnalyseView } from "@/lib/analyse-view";
import {
  type DataError,
  describeDataError,
  isDataError,
} from "@/lib/data-error";
import { loadCyclingAnalysis } from "@/lib/db/queries";
import { formatUpdatedAt } from "@/lib/format";
import { RAIL_GRID } from "@/lib/rail-grid";
import { resolveToday } from "@/lib/training-view";

export const metadata: Metadata = { title: "Analyse" };

type Ready = Extract<AnalyseView, { kind: "ready" }>;
type PageState =
  | { readonly kind: "empty" }
  | (Ready & { readonly answers: AnswersView })
  | { readonly kind: "error"; readonly error: DataError; readonly at: Date };

async function loadPageState(): Promise<PageState> {
  try {
    const data = await loadCyclingAnalysis();
    const now = new Date();
    const today = resolveToday(now, process.env);
    const view = buildAnalyseView(data, now, today);
    if (view.kind === "empty") return view;
    return { ...view, answers: buildAnswers(data.summary, data.summaryError, Number(today.slice(0, 4))) };
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
      <div className="flex flex-col">
        <AnalyseTabs current="cykel" />
        <h2 className="sr-only">Cykel</h2>
        {state.kind === "ready" && (
          <div className="mt-2">
            <UpdatedLine
              freshness={state.freshness}
              staleNote="Jobbet skal køre dagligt omkring kl. 05.00."
              unknownNote="Opdateringstidspunkt ukendt, så data kan være forældet."
            />
          </div>
        )}
        {state.kind === "ready" && (
          // §11/§12c: header row above, full width; from lg a 12-column grid, rail = the three answers
          // (sticky, scrolls on its own), main = the cards, one width so the seams line up. DOM order
          // stays the phone order: answers, then charts.
          <div className={RAIL_GRID.grid}>
            <div className={RAIL_GRID.railScroll}>
              <AnswerBlocks view={state.answers} />
            </div>
            <div className={RAIL_GRID.main}>
              <Cards view={state} />
            </div>
          </div>
        )}
      </div>
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
    </>
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
            {/* The eFTP line's legend item lives in the readout row's cell (DESIGN.md Charts: interaction). */}
            <Legend items={[{ swatch: <Hollow />, label: "Udeladt tur" }]} />
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
        {"kind" in view.ef ? (
          // §12b: the explainer moved into block 2's "?"; the ride list stays, with one line.
          <div className="flex flex-col gap-2">
            {view.ef.list.length > 0 && (
              <ul className="flex flex-col gap-1 text-16 tabular-nums">
                {view.ef.list.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            <p className="max-w-[60ch] text-14 text-text-muted">
              {view.ef.note}
            </p>
          </div>
        ) : (
          <figure className="flex flex-col gap-2">
            {/* Trend and Tur live in the readout row's cells (DESIGN.md Charts: interaction). */}
            <Legend items={[{ swatch: <Hollow />, label: "Udeladt tur" }]} />
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
      className="rounded-card bg-surface px-4 py-2 shadow-card lg:px-6"
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
          <ul className="flex flex-col gap-3 lg:hidden">
            {view.excluded.items.map((it) => (
              <li key={it.key}>
                <p className="text-16 font-semibold">{`${it.date} · ${it.reason}`}</p>
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
          {/* §11: from lg the same rows as a real table; a dropped fact stays dropped. */}
          <table className="hidden w-full text-left text-14 lg:table">
            <caption className="sr-only">Udeladte ture</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-bold whitespace-nowrap">Dato</th>
                <th scope="col" className="py-2 pr-4 font-bold">Årsag</th>
                <th scope="col" className="py-2 pr-4 font-bold">Forklaring</th>
                <th scope="col" className="py-2 font-bold">Fakta</th>
              </tr>
            </thead>
            <tbody>
              {view.excluded.items.map((it) => (
                <tr key={it.key} className="border-b border-border last:border-b-0 align-top">
                  <th scope="row" className="py-2 pr-4 font-semibold whitespace-nowrap">{it.date}</th>
                  <td className="py-2 pr-4 whitespace-nowrap">{it.reason}</td>
                  <td className="py-2 pr-4">{it.explanation}</td>
                  <td className="py-2 whitespace-nowrap text-text-muted tabular-nums">{it.facts}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
