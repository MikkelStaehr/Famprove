import type { Metadata } from "next";

import { E1rmPanels, TonnageStrips } from "@/components/AnalyseCharts";
import { AnalyseTabs } from "@/components/AnalyseTabs";
import { Card } from "@/components/Card";
import { BarSwatch, BracketSwatch, HollowDotSwatch, TodayTickSwatch } from "@/components/ChartMarks";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { UpdatedLine } from "@/components/UpdatedLine";
import { WarningLine } from "@/components/WarningLine";
import { buildStyrkeView, feelRows, NO_E1RM, type StyrkeView, TONNAGE_EXPLAINER } from "@/lib/analyse-styrke-view";
import { MARKS } from "@/lib/chart-marks";
import { LIFT_NAME, LIFTS } from "@/lib/lifts";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { loadExerciseFeel, loadStrengthAnalysis } from "@/lib/db/queries";
import { formatUpdatedAt } from "@/lib/format";
import { RAIL_GRID } from "@/lib/rail-grid";
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
      <div className="flex flex-col">
        <AnalyseTabs current="styrke" />
        <h2 className="sr-only">Styrke</h2>
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
          // §11: header row above, full width; from lg a 12-column grid, rail = the board (sticky), main = the cards,
          // one width so the block ruler and week columns align. DOM order stays the phone order.
          <div className={RAIL_GRID.grid}>
            <div className={RAIL_GRID.rail}>
              <Board view={state} />
            </div>
            <div className={RAIL_GRID.main}>
              <Cards view={state} />
            </div>
          </div>
        )}
      </div>
      {state.kind === "error" && (
        <ErrorState
          title="Kunne ikke hente styrkedata"
          what={describeDataError(state.error)}
          detail={state.error.message}
          at={{ iso: state.at.toISOString(), text: formatUpdatedAt(state.at.toISOString()) }}
          retry={{ href: "/analyse/styrke" }}
        />
      )}
      {state.kind === "empty" && (
        <EmptyState message="Der er ingen styrkeuger endnu. Det daglige job læser arket omkring kl. 05.00." />
      )}
    </>
  );
}

/**
 * §4: the lift board, three big tabular numbers (instrument-analyse.md §3: Inter 400 56, hairline
 * between rows); colour = RPE provenance (--text logged / --text-muted prescribed), words carry it too.
 */
function Board({ view }: { readonly view: Ready }) {
  const { board } = view;
  return (
    <section aria-label="Bedste e1RM" className="mt-2 lg:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="caption">{board.label}</p>
        {board.phase !== null && <p className="text-14 text-text">{board.phase}</p>}
      </div>
      <p className="sr-only">{board.sr}</p>
      <dl aria-hidden="true" className="mt-2 flex flex-col">
        {board.rows.map((r) => (
          // Name and number share the first row (baseline-aligned); the set line and provenance run
          // full width below, so the three rows and the Squat panel fit the 390 fold (§5.1).
          <div
            key={r.lift}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border py-1.5 first:pt-0 last:border-b-0"
          >
            <dt className="contents">
              <span className="col-start-1 row-start-1 block text-20 font-normal">{r.name}</span>
              {r.lines.map((l) => (
                <span key={l} className="col-span-2 block text-14 leading-[1.25] text-text-muted tabular-nums">
                  {l}
                </span>
              ))}
            </dt>
            <dd
              className={`col-start-2 row-start-1 text-right font-sans text-56 leading-[0.85] font-normal tabular-nums ${
                r.logged ? "text-text" : "text-text-muted"
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {board.firstNote !== null && <p className="mt-2 max-w-[60ch] text-14 text-text-muted">{board.firstNote}</p>}
    </section>
  );
}

function Cards({ view }: { readonly view: Ready }) {
  const axis = { lo: view.lo, hi: view.hi, ticksNarrow: view.ticksNarrow, ticksWide: view.ticksWide };
  const deload = view.hasDeload ? [{ swatch: <BracketSwatch deload />, label: "Deload" }] : [];
  return (
    <>
      <Card id="e1rm" variant="calm" level={3} title="Estimeret 1RM pr. uge">
        <figure className="-mt-1 flex flex-col gap-2">
          {view.panels === null ? (
            <p className="max-w-[60ch] text-16 text-text-muted">{NO_E1RM}</p>
          ) : (
            <>
              <Legend
                items={[
                  { swatch: <Dot />, label: "Logget RPE" },
                  { swatch: <HollowDotSwatch r={MARKS.e1rm.prescribed.r} />, label: "Foreskrevet RPE" },
                  { swatch: <BestTick />, label: "Bedst i blokken" },
                  ...(view.hasSheet ? [{ swatch: <Dashed />, label: "1RM i arket (ikke testet)" }] : []),
                  ...deload,
                ]}
              />
              <E1rmPanels axis={axis} blocks={view.blocks} phaseRules={view.phaseRules} weeks={view.weeks} panels={view.panels} />
              <figcaption className="sr-only">
                {[...view.panels.map((p) => p.sr), ...(view.phaseSr === null ? [] : [view.phaseSr])].join(" ")}
              </figcaption>
            </>
          )}
        </figure>
        {/* After the figure: a figcaption must be its first or last child. */}
        <div className="mt-2 flex flex-col gap-2">
          {view.notes.map((n) => (
            <p key={n} className="max-w-[60ch] text-14 text-text-muted">
              {n}
            </p>
          ))}
        </div>
      </Card>

      <Card id="tonnage" variant="calm" level={3} title="Tonnage pr. uge">
        <figure className="flex flex-col gap-2">
          <Legend
            items={[
              { swatch: <BarSwatch />, label: "Uge med løft" },
              { swatch: <BarSwatch zero />, label: "Intet løftet" },
              { swatch: <TodayTickSwatch />, label: "I dag" },
              ...deload,
            ]}
          />
          <TonnageStrips axis={axis} blocks={view.blocks} phaseRules={view.phaseRules} weeks={view.weeks} max={view.tonnageMax} />
          <p className="max-w-[60ch] text-14 text-text-muted">{TONNAGE_EXPLAINER}</p>
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

      {view.rpeLine !== null && <p className="max-w-[60ch] text-14 text-text-muted">{view.rpeLine}</p>}
    </>
  );
}

function Legend({ items }: { readonly items: readonly { readonly swatch: React.ReactNode; readonly label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-14 text-text-muted" aria-label="Forklaring">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Logged e1RM: a filled ink dot r 3. */
function Dot() {
  const m = MARKS.e1rm.logged;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className="h-3 w-6 shrink-0">
      <circle cx="7" cy="6" r={m.r} fill={m.fill} />
      <circle cx="17" cy="6" r={m.r} fill={m.fill} />
    </svg>
  );
}

/** Block best: the point with a 1×6 ink tick 3px above it. */
function BestTick() {
  const b = MARKS.e1rm.best;
  const r = MARKS.e1rm.logged.r;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 16" className="h-4 w-6 shrink-0">
      <rect x={12 - b.width / 2} y={16 - 2 * r - b.gap - b.height} width={b.width} height={b.height} fill={b.color} />
      <circle cx="12" cy={16 - r} r={r} fill={MARKS.e1rm.logged.fill} />
    </svg>
  );
}

/** The sheet's untested 1RM: dashed 6 4. */
function Dashed() {
  const m = MARKS.e1rm.sheet;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className="h-3 w-6 shrink-0">
      <line x1="0" x2="24" y1="6" y2="6" stroke={m.color} strokeWidth={m.width} strokeDasharray={m.dash} />
    </svg>
  );
}

/**
 * "Sådan føles sættene" (fokus-pause.md §7): one row per exercise_feel row, Python's sentence
 * verbatim. Absent with no rows; a failed read shows a WarningLine in its place.
 */
async function FeelCard() {
  const rows = await loadExerciseFeel();
  if (rows === null) {
    return (
      <WarningLine>
        Kunne ikke hente dine vurderinger.{" "}
        <a href="/analyse/styrke" className="font-medium text-text underline decoration-1 underline-offset-3">
          Prøv igen
        </a>
      </WarningLine>
    );
  }
  const items = feelRows(rows);
  if (items.length === 0) return null;
  return (
    <Card id="feel" variant="calm" level={3} title="Sådan føles sættene">
      <ul className="flex flex-col gap-3">
        {items.map((r) => (
          <li key={r.id} className="flex max-w-[60ch] flex-col">
            <span className="text-16 font-medium">{r.name}</span>
            <span className="text-16">{r.verdict}</span>
            <span className="text-14 text-text-muted">{r.basis}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
