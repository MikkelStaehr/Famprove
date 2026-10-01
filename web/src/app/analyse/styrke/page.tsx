import type { Metadata } from "next";

import { E1rmPanels, TonnageStrips } from "@/components/AnalyseCharts";
import { AnalyseTabs } from "@/components/AnalyseTabs";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { UpdatedLine } from "@/components/UpdatedLine";
import { buildStyrkeView, NO_E1RM, type StyrkeView, TONNAGE_EXPLAINER } from "@/lib/analyse-styrke-view";
import { LIFT_NAME, LIFTS } from "@/lib/lifts";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { loadStrengthAnalysis } from "@/lib/db/queries";
import { formatUpdatedAt } from "@/lib/format";
import { resolveToday } from "@/lib/today-view";

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
        {state.kind === "ready" && <Board view={state} />}
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
      {state.kind === "ready" && <Cards view={state} />}
    </>
  );
}

/** §4: the lift board, a meet-board of three big tabular numbers; colour = RPE provenance, words carry it too. */
function Board({ view }: { readonly view: Ready }) {
  const { board } = view;
  return (
    <section aria-label="Bedste e1RM" className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-14 font-bold tracking-[0.04em] uppercase">{board.label}</p>
        {board.phase !== null && <p className="text-14 font-semibold text-text">{board.phase}</p>}
      </div>
      <p className="sr-only">{board.sr}</p>
      <dl aria-hidden="true" className="mt-2 flex flex-col gap-3">
        {board.rows.map((r) => (
          <div key={r.lift} className="flex flex-wrap justify-between gap-x-3 [align-items:last_baseline]">
            <dt className="min-w-0">
              <span className="block text-20 font-bold">{r.name}</span>
              {r.lines.map((l) => (
                <span key={l} className="block text-14 leading-[1.25] text-text-muted tabular-nums">
                  {l}
                </span>
              ))}
            </dt>
            <dd
              className={`ml-auto max-w-full text-right font-display text-56 leading-none font-extrabold italic tabular-nums ${
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
  const deload = view.hasDeload ? [{ swatch: <Hatch />, label: "Deload" }] : [];
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
                  { swatch: <Dot logged />, label: "Logget RPE" },
                  { swatch: <Dot logged={false} />, label: "Foreskrevet RPE" },
                  { swatch: <Ring />, label: "Bedst i blokken" },
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
              { swatch: <Bar className="bg-text-muted" />, label: "Uge med løft" },
              { swatch: <Bar className="bg-slab" />, label: "Denne uge" },
              { swatch: <ZeroTick />, label: "Intet løftet" },
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

      {view.rpeLine !== null && <p className="max-w-[60ch] text-14 text-text-muted">{view.rpeLine}</p>}
    </>
  );
}

function Legend({ items }: { readonly items: readonly { readonly swatch: React.ReactNode; readonly label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-14 text-text" aria-label="Forklaring">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Dot({ logged }: { readonly logged: boolean }) {
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
      <span className={`block rounded-full ${logged ? "size-2.5 bg-text" : "size-[7px] bg-chart-mark"}`} />
    </span>
  );
}

function Ring() {
  return <span aria-hidden="true" className="block size-4 shrink-0 rounded-full border-2 border-text" />;
}

function Dashed() {
  return (
    <span
      aria-hidden="true"
      className="block h-[1.5px] w-6 shrink-0"
      style={{ backgroundImage: "repeating-linear-gradient(to right, var(--text-muted) 0 6px, transparent 6px 10px)" }}
    />
  );
}

function Hatch() {
  return (
    <span
      aria-hidden="true"
      className="block size-3 shrink-0 bg-block-fill"
      style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--chart-mark) 0 1.5px, transparent 1.5px 6px)" }}
    />
  );
}

function Bar({ className }: { readonly className: string }) {
  return <span aria-hidden="true" className={`h-3 w-2 shrink-0 ${className}`} />;
}

function ZeroTick() {
  return <span aria-hidden="true" className="mt-2.5 h-0.5 w-2 shrink-0 bg-chart-mark" />;
}
