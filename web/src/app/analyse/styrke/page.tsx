import type { Metadata } from "next";

import { E1rmPanels, TonnageStrips } from "@/components/AnalyseCharts";
import {
  BarSwatch,
  BestSwatch,
  DeloadBracketSwatch,
  Legend,
  LoggedSwatch,
  PrescribedSwatch,
  SheetSwatch,
  TodaySwatch,
} from "@/components/AnalyseLegend";
import { AnalyseHeader } from "@/components/AnalyseTabs";
import { ANSWER_CARD } from "@/components/AnswerBlock";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { MonoCaption } from "@/components/MonoCaption";
import { WarningLine } from "@/components/WarningLine";
import { ANALYSE_GRID } from "@/lib/analyse-grid";
import { buildStyrkeView, feelRows, NO_E1RM, type StyrkeView, TONNAGE_EXPLAINER } from "@/lib/analyse-styrke-view";
import { LIFT_NAME, LIFTS } from "@/lib/lifts";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { loadExerciseFeel, loadStrengthAnalysis } from "@/lib/db/queries";
import { formatUpdatedAt } from "@/lib/format";
import { resolveToday } from "@/lib/training-view";

export const metadata: Metadata = { title: "Analyse · Styrke" };

type Ready = Extract<StyrkeView, { kind: "ready" }>;
type PageState = StyrkeView | { readonly kind: "error"; readonly error: DataError; readonly at: Date };

async function loadPageState(): Promise<PageState> {
  try {
    const data = await loadStrengthAnalysis();
    const now = new Date();
    const view = buildStyrkeView(data, now, resolveToday(now, process.env));
    if (view.kind === "ready") for (const w of view.warnings) console.warn(w);
    return view;
  } catch (error) {
    if (isDataError(error)) {
      console.error("analyse/styrke: loading data failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

export default async function Page() {
  const state = await loadPageState();
  return (
    <>
      <AnalyseHeader current="styrke" freshness={state.kind === "ready" ? state.freshness : null} />
      <div className={ANALYSE_GRID.grid}>
        {state.kind === "ready" && (
          // §7: DOM order = phone order (board, e1RM, tonnage, feel, RPE line); grid placement does the rest.
          <>
            <Board view={state} />
            <Cards view={state} />
          </>
        )}
        {state.kind === "error" && (
          <div className={`${ANSWER_CARD} ${ANALYSE_GRID.full}`}>
            <ErrorState
              title="Kunne ikke hente styrkedata"
              what={describeDataError(state.error)}
              detail={state.error.message}
              at={{ iso: state.at.toISOString(), text: formatUpdatedAt(state.at.toISOString()) }}
              retry={{ href: "/analyse/styrke" }}
            />
          </div>
        )}
        {state.kind === "empty" && (
          <div className={`${ANSWER_CARD} ${ANALYSE_GRID.full}`}>
            <EmptyState message="Der er ingen styrkeuger endnu. Det daglige job læser arket omkring kl. 05.00." />
          </div>
        )}
      </div>
    </>
  );
}

/** The board's sentence lines (Geist 13); the set line and the earlier block's value are numbers (Geist Mono 12). */
const isSentence = (line: string) => line === "logget RPE" || line === "baseret på foreskrevet RPE" || line.startsWith("Intet e1RM");

/**
 * §3: the lift board as the hero card (radius 26, padding 22 20 16): three ListRows in SBD order,
 * the value Geist Mono 500 right, colour = RPE provenance (--text logged / --text-muted prescribed),
 * the words on the left carry it too. The <dl> stays aria-hidden behind the sr sentence.
 */
function Board({ view }: { readonly view: Ready }) {
  const { board } = view;
  return (
    <section
      aria-label="Bedste e1RM"
      className={`flex min-w-0 flex-col gap-3 rounded-hero border border-border bg-card px-5 pt-5.5 pb-4 ${ANALYSE_GRID.styrkeHero}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <MonoCaption size={12}>{board.label}</MonoCaption>
        {board.phase !== null && <MonoCaption size={11}>{board.phase}</MonoCaption>}
      </div>
      <p className="sr-only">{board.sr}</p>
      <dl aria-hidden="true" className="flex flex-col">
        {board.rows.map((r) => {
          const kg = r.value.endsWith(" kg");
          return (
            <div
              key={r.lift}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-border py-3 first:border-t-0 first:pt-0"
            >
              <dt className="flex min-w-0 flex-col gap-0.5">
                <span className="font-sans text-16 font-medium text-text">{r.name}</span>
                {r.lines.map((l) =>
                  isSentence(l) ? (
                    <span key={l} className="font-sans text-13 text-text-muted">
                      {l}
                    </span>
                  ) : (
                    <span key={l} className="font-mono text-12 text-text-muted">
                      {l}
                    </span>
                  ),
                )}
              </dt>
              {/* Spec: Geist Mono 40; the scale has no text-40, so text-48 (reported to design-lead). */}
              <dd className={`text-right font-mono text-48 font-medium ${r.logged ? "text-text" : "text-text-muted"}`}>
                {kg ? r.value.slice(0, -3) : r.value}
                {kg && <span className="ml-1 font-mono text-14 font-normal tracking-normal text-text-muted">kg</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {board.firstNote !== null && (
        <p className="max-w-[60ch] border-t border-border pt-3 font-sans text-13 text-text-muted">{board.firstNote}</p>
      )}
    </section>
  );
}

function Unit() {
  return (
    <MonoCaption size={11} uppercase>
      kg
    </MonoCaption>
  );
}

function Cards({ view }: { readonly view: Ready }) {
  const axis = { lo: view.lo, hi: view.hi, ticksNarrow: view.ticksNarrow, ticksWide: view.ticksWide };
  return (
    <>
      <Card id="e1rm" level={3} title="Estimeret 1RM pr. uge" action={<Unit />} className={`${ANALYSE_GRID.styrkeChart} lg:row-start-1`}>
        <figure className="flex flex-col gap-3.5">
          {view.panels === null ? (
            <p className="max-w-[60ch] font-sans text-15 text-text-muted">{NO_E1RM}</p>
          ) : (
            <>
              <E1rmPanels
                axis={axis}
                blocks={view.blocks}
                phaseRules={view.phaseRules}
                weeks={view.weeks}
                panels={view.panels}
                todayX={view.todayX}
              />
              <Legend
                items={[
                  { swatch: <LoggedSwatch />, label: "Logget RPE" },
                  { swatch: <PrescribedSwatch />, label: "Foreskrevet RPE" },
                  { swatch: <BestSwatch />, label: "Bedst i blokken" },
                  ...(view.hasSheet ? [{ swatch: <SheetSwatch />, label: "1RM i arket (ikke testet)" }] : []),
                  ...(view.hasDeload ? [{ swatch: <DeloadBracketSwatch />, label: "Deload" }] : []),
                  { swatch: <TodaySwatch />, label: "I dag" },
                ]}
              />
              <figcaption className="sr-only">
                {[...view.panels.map((p) => p.sr), ...(view.phaseSr === null ? [] : [view.phaseSr])].join(" ")}
              </figcaption>
            </>
          )}
        </figure>
        {/* After the figure: a figcaption must be its first or last child. */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {view.notes.map((n) => (
            <p key={n} className="max-w-[60ch] font-sans text-13 text-text-muted">
              {n}
            </p>
          ))}
        </div>
      </Card>

      <Card id="tonnage" level={3} title="Tonnage pr. uge" action={<Unit />} className={`${ANALYSE_GRID.styrkeChart} lg:row-start-2`}>
        <figure className="flex flex-col gap-3.5">
          <TonnageStrips
            axis={axis}
            blocks={view.blocks}
            phaseRules={view.phaseRules}
            weeks={view.weeks}
            max={view.tonnageMax}
            todayX={view.todayX}
          />
          <Legend
            items={[
              { swatch: <BarSwatch />, label: "Uge med løft" },
              ...(view.hasDeload ? [{ swatch: <BarSwatch kind="deload" />, label: "Deload" }] : []),
              { swatch: <BarSwatch kind="zero" />, label: "Intet løftet" },
              { swatch: <TodaySwatch />, label: "I dag" },
            ]}
          />
          <p className="max-w-[60ch] font-sans text-13 text-text-muted">{TONNAGE_EXPLAINER}</p>
          <div className="sr-only">
            <table>
              <caption>Tonnage pr. uge</caption>
              <thead>
                <tr>
                  <th scope="col">Uge</th>
                  <th scope="col">Blok</th>
                  {LIFTS.map((l) => (
                    <th key={l} scope="col">{`${LIFT_NAME[l]} (kg)`}</th>
                  ))}
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
      </Card>

      <FeelCard />

      {view.rpeLine !== null && (
        <p className={`max-w-[60ch] px-1 font-sans text-13 text-text-muted ${ANALYSE_GRID.styrkeChart} lg:row-start-3`}>{view.rpeLine}</p>
      )}
    </>
  );
}

/**
 * "Sådan føles sættene" (fokus-pause.md §7; look reset-analyse-styrke.md §6): one ListRow per
 * exercise_feel row, Python's sentence verbatim. Absent with no rows; a failed read is a card with
 * the WarningLine and a 44px Prøv igen link.
 */
async function FeelCard() {
  const rows = await loadExerciseFeel();
  if (rows === null) {
    return (
      <div className={`${ANSWER_CARD} ${ANALYSE_GRID.styrkeSide} lg:row-start-2`}>
        <WarningLine>
          Kunne ikke hente dine vurderinger.{" "}
          <a href="/analyse/styrke" className="inline-flex min-h-11 items-center font-medium text-text underline decoration-1 underline-offset-3">
            Prøv igen
          </a>
        </WarningLine>
      </div>
    );
  }
  const items = feelRows(rows);
  if (items.length === 0) return null;
  return (
    <Card id="feel" level={3} title="Sådan føles sættene" className={`${ANALYSE_GRID.styrkeSide} lg:row-start-2`}>
      <ul className="flex flex-col">
        {items.map((r) => (
          <li key={r.id} className="flex max-w-[60ch] flex-col gap-0.5 border-t border-border py-3 first:border-t-0 first:pt-0">
            <span className="font-sans text-15 font-medium text-text">{r.name}</span>
            <span className="font-sans text-15 text-text">{r.verdict}</span>
            <span className="font-sans text-13 text-text-muted">{r.basis}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
