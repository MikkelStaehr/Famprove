"use client";

import { useEffect, useState } from "react";

import { clearPerf, formatPerf, installPerfProbe, mediansByKind, PERF_KINDS, PERF_OPEN_EVENT, type PerfEntry, readPerf } from "@/lib/perf-probe";

const BUTTON =
  "min-h-11 rounded-button border border-text-muted px-4 text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text";
const ms = (v: number | null) => (v === null ? "–" : String(Math.round(v)));

/**
 * tab-perf-probe's hidden view (local only): installs the probe once, and opens on a long-press of
 * an "opdateret" line or Shift+P. The entries, the median per kind, Kopiér (plain text) and Ryd.
 */
export function PerfSheet() {
  const [entries, setEntries] = useState<PerfEntry[] | null>(null);
  useEffect(() => {
    installPerfProbe();
    const open = () => setEntries(readPerf());
    window.addEventListener(PERF_OPEN_EVENT, open);
    return () => window.removeEventListener(PERF_OPEN_EVENT, open);
  }, []);
  useEffect(() => {
    if (entries === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEntries(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries]);
  if (entries === null) return null;
  const med = mediansByKind(entries);
  return (
    <div role="dialog" aria-modal="true" aria-label="Målinger" data-noswipe className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setEntries(null)}>
      <div
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-button bg-card p-4 pb-[max(16px,env(safe-area-inset-bottom))] font-mono text-12 text-text"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-text-muted">{entries.length} målinger · ms · kald</p>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-text-muted">
            <tr>
              <th className="font-normal">median</th>
              <th className="font-normal">n</th>
              <th className="font-normal">indhold</th>
              <th className="font-normal">færdig</th>
              <th className="font-normal">kald</th>
            </tr>
          </thead>
          <tbody>
            {PERF_KINDS.map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{med[k].n}</td>
                <td>{ms(med[k].tapToContent)}</td>
                <td>{ms(med[k].tapToSettled)}</td>
                <td>{med[k].serverRequests ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ol className="mt-3 flex flex-col gap-1">
          {[...entries].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`}>
              {e.kind} {e.from}→{e.to} · {ms(e.tapToContent)} · {ms(e.tapToSettled)} · {e.serverRequests}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex gap-3">
          <button type="button" className={BUTTON} onClick={() => void navigator.clipboard?.writeText(formatPerf(entries)).catch(() => undefined)}>
            Kopiér
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              clearPerf();
              setEntries([]);
            }}
          >
            Ryd
          </button>
          <button type="button" className={`${BUTTON} ml-auto`} onClick={() => setEntries(null)}>
            Luk
          </button>
        </div>
      </div>
    </div>
  );
}
