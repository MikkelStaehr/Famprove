import type { Metadata } from "next";

import { MarkChart, WeekStrips } from "@/components/AnalyseCharts";
import { BarSwatch, CrossSwatch, DotSizesSwatch, Legend, LineSwatch, RideDotSwatch, TodaySwatch } from "@/components/AnalyseLegend";
import { AnalyseHeader } from "@/components/AnalyseTabs";
import { ANSWER_CARD, AnswerBlocks } from "@/components/AnswerBlock";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/icons";
import { MonoCaption } from "@/components/MonoCaption";
import { type AnswersView, buildAnswers } from "@/lib/analyse-answers";
import { ANALYSE_GRID } from "@/lib/analyse-grid";
import { type AnalyseView, buildAnalyseView } from "@/lib/analyse-view";
import {
  type DataError,
  describeDataError,
  isDataError,
} from "@/lib/data-error";
import { loadCyclingAnalysis } from "@/lib/db/queries";
import { formatUpdatedAt } from "@/lib/format";
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
      <AnalyseHeader current="cykel" freshness={state.kind === "ready" ? state.freshness : null} />
      <div className={ANALYSE_GRID.grid}>
        {state.kind === "ready" && (
          // §6: DOM order = phone order (answers, charts, excluded); grid placement does the rest.
          <>
            <AnswerBlocks view={state.answers} />
            <Cards view={state} />
          </>
        )}
        {state.kind === "error" && (
          <div className={`${ANSWER_CARD} ${ANALYSE_GRID.full}`}>
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
          </div>
        )}
        {state.kind === "empty" && (
          <div className={`${ANSWER_CARD} ${ANALYSE_GRID.full}`}>
            <EmptyState message="Der er ingen cykelture siden 1. jan. 2025 endnu. Det daglige job henter dem omkring kl. 05.00." />
          </div>
        )}
      </div>
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

/** The unit at the right of a chart card's header (MonoCaption 11). */
function Unit({ children }: { readonly children: string }) {
  return (
    <MonoCaption size={11} uppercase={false}>
      {children}
    </MonoCaption>
  );
}

function Cards({ view }: { readonly view: Ready }) {
  const axis = axisOf(view);
  return (
    <>
      <Card id="eftp" level={3} title="eFTP pr. tur" action={<Unit>W</Unit>} className={ANALYSE_GRID.cykelChart}>
        {view.eftp === null ? (
          <div className="flex h-(--chart-height) items-center rounded-button border border-dashed border-border px-4 font-sans text-15 text-text-muted">
            Trenden vises, når der er mindst to ture med watt.
          </div>
        ) : (
          <figure className="flex flex-col gap-3.5">
            <MarkChart axis={axis} chart={view.eftp} title="eFTP pr. tur" variant="eftp" />
            {view.noWattNote !== null && <p className="max-w-[60ch] font-sans text-13 text-text-muted">{view.noWattNote}</p>}
            {/* The eFTP line's legend item lives in the readout row's cell (DESIGN.md Charts: interaction). */}
            <Legend
              items={[
                { swatch: <DotSizesSwatch />, label: "eFTP · størrelse = TSS" },
                { swatch: <CrossSwatch />, label: "Udeladt tur" },
              ]}
            />
            <figcaption className="sr-only">{view.eftp.sr}</figcaption>
          </figure>
        )}
      </Card>

      <Card id="ef" level={3} title="Effektivitet på rolige ture" action={<Unit>EF</Unit>} className={ANALYSE_GRID.cykelChart}>
        {"kind" in view.ef ? (
          // ef-few (§4b): no plot; the note, then the rides as ListRows (date left, EF right).
          <div className="flex flex-col gap-2">
            <p className="max-w-[60ch] font-sans text-13 text-text-muted">{view.ef.note}</p>
            {view.ef.list.length > 0 && (
              <ul className="flex flex-col">
                {view.ef.list.map((l) => {
                  const [date, value] = l.split(" · ");
                  return (
                    <li key={l} className="flex min-h-11 items-center justify-between gap-3 border-t border-border">
                      <span className="font-mono text-12 text-text-muted">{date}</span>
                      <span className="font-mono text-15 text-text">{value}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <figure className="flex flex-col gap-3.5">
            <MarkChart axis={axis} chart={view.ef} title="Effektivitet på rolige ture" variant="ef" />
            {/* Trend and Tur also live in the readout row's cells (DESIGN.md Charts: interaction). */}
            <Legend
              items={[
                { swatch: <LineSwatch />, label: "Trend (median over 28 dage)" },
                { swatch: <RideDotSwatch />, label: "Tur" },
                { swatch: <CrossSwatch />, label: "Udeladt tur" },
              ]}
            />
            <figcaption className="sr-only">{view.ef.sr}</figcaption>
          </figure>
        )}
      </Card>

      <Card id="weeks" level={3} title="Timer og belastning pr. uge" className={ANALYSE_GRID.cykelChart}>
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
          <figure className="flex flex-col gap-3.5">
            <WeekStrips axis={axis} weeks={view.weeks} max={view.weekMax} />
            <Legend
              items={[
                { swatch: <BarSwatch />, label: "Uge med ture" },
                { swatch: <BarSwatch kind="zero" />, label: "Uge uden ture" },
                { swatch: <TodaySwatch />, label: "I dag" },
              ]}
            />
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
    return <p className={`px-1 font-sans text-13 text-text-muted ${ANALYSE_GRID.cykelSide}`}>Ingen ture udeladt fra trends.</p>;
  return (
    <section aria-label="Udeladte ture" className={`rounded-card border border-border bg-card px-5 ${ANALYSE_GRID.cykelSide}`}>
      <details className="group">
        <summary className="flex min-h-14 w-full cursor-pointer list-none items-center justify-between gap-2 font-sans text-16 font-medium text-text [&::-webkit-details-marker]:hidden">
          {view.excluded.summary}
          <Icon
            name="chevron-down"
            size={20}
            className="text-text-muted group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-180 motion-safe:ease-out"
          />
        </summary>
        <div className="flex flex-col gap-2 pb-4">
          <p className="font-sans text-13 text-text-muted">De tæller stadig med i timer og belastning.</p>
          <ul className="flex flex-col lg:hidden">
            {view.excluded.items.map((it) => (
              <li key={it.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-t border-border py-3">
                <span className="font-mono text-12 text-text-muted">{it.date}</span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-sans text-15 font-medium text-text">{it.reason}</p>
                  {it.explanation !== null && <p className="font-sans text-13 text-text">{it.explanation}</p>}
                  {it.facts !== "" && <p className="font-mono text-12 text-text-muted">{it.facts}</p>}
                </div>
              </li>
            ))}
          </ul>
          {/* §6: from lg the same rows as a real table; a dropped fact stays dropped. */}
          <table className="hidden w-full text-left lg:table">
            <caption className="sr-only">Udeladte ture</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-3 font-mono text-11 font-normal whitespace-nowrap text-text-muted uppercase">Dato</th>
                <th scope="col" className="py-2 pr-3 font-mono text-11 font-normal text-text-muted uppercase">Årsag</th>
                <th scope="col" className="py-2 pr-3 font-mono text-11 font-normal text-text-muted uppercase">Forklaring</th>
                <th scope="col" className="py-2 font-mono text-11 font-normal text-text-muted uppercase">Fakta</th>
              </tr>
            </thead>
            <tbody>
              {view.excluded.items.map((it) => (
                <tr key={it.key} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="py-2 pr-3 font-mono text-12 font-normal whitespace-nowrap text-text-muted">{it.date}</th>
                  <td className="py-2 pr-3 font-sans text-13 font-medium text-text">{it.reason}</td>
                  <td className="py-2 pr-3 font-sans text-13 text-text">{it.explanation}</td>
                  <td className="py-2 font-mono text-12 text-text-muted">{it.facts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
