"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import { formatTimeOfDay } from "@/lib/format";
import {
  isPending,
  waitShownUntil,
  parseRefreshAnswer,
  parseRefreshStatus,
  phaseAfter,
  POLL_INTERVAL_MS,
  type RefreshPhase,
  refreshMessage,
} from "@/lib/refresh";

import { Icon } from "./icons";
import { WarningLine } from "./WarningLine";

/**
 * "Hent data nu" (design/specs/refresh.md): a ↻ after the "opdateret" time and one status line
 * under it. The provider holds the phase, so it survives router.refresh() and a ↻ that moves from
 * the stale WarningLine to the fresh line (the new one takes the focus back).
 */

const DONE_SHOWN_MS = 5_000;

type RefreshContextValue = {
  readonly phase: RefreshPhase;
  readonly start: () => void;
  /** A focused ↻ unmounted (stale → fresh): the next one to mount takes the focus. */
  readonly focusNextRef: { current: boolean };
};

const RefreshContext = createContext<RefreshContextValue | null>(null);

function clock(ms: number): string {
  return formatTimeOfDay(new Date(ms).toISOString());
}

export function RefreshProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<RefreshPhase>({ kind: "idle" });
  const focusNextRef = useRef(false);
  const pendingRef = useRef(false); // a second tap before the re-render sends nothing (R3)

  useEffect(() => {
    pendingRef.current = isPending(phase);
    if (phase.kind === "polling") {
      let cancelled = false;
      let timer = 0;
      const tick = async () => {
        if (Date.now() > phase.until) return setPhase({ kind: "timeout" });
        try {
          const res = await fetch(`/api/refresh?since=${phase.since}`, { cache: "no-store" });
          const status = parseRefreshStatus(await res.json());
          if (cancelled) return;
          if (status.kind === "success") {
            router.refresh();
            return setPhase({ kind: "done" });
          }
          if (status.kind === "failure") return setPhase({ kind: "failed" });
        } catch {
          // A missed poll (offline, a redeploy): ask again until the limit.
        }
        if (!cancelled) timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      };
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    // "data hentet" for 5 s; the wait line until its time.
    const clearAfter =
      phase.kind === "done" ? DONE_SHOWN_MS : phase.kind === "wait" ? waitShownUntil(phase.until) - Date.now() : null;
    if (clearAfter === null) return;
    const timer = window.setTimeout(() => setPhase({ kind: "idle" }), Math.max(0, clearAfter));
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  const start = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPhase({ kind: "sending" });
    void (async () => {
      try {
        const res = await fetch("/api/refresh", { method: "POST", cache: "no-store" });
        setPhase(phaseAfter(parseRefreshAnswer(await res.json()), Date.now()));
      } catch {
        setPhase({ kind: "error" }); // no answer, or not JSON (e.g. a login page)
      }
    })();
  }, []);

  return <RefreshContext value={{ phase, start, focusNextRef }}>{children}</RefreshContext>;
}

function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (ctx === null) throw new Error("RefreshButton and RefreshStatus need a RefreshProvider");
  return ctx;
}

/**
 * The ↻: a 44px target around a 16px glyph, pulled into the 12px line by negative margins so the
 * line keeps its height (refresh.md §1). `attention`: stale or unknown data, the glyph in --text.
 */
export function RefreshButton({ attention }: { readonly attention: boolean }) {
  const { phase, start, focusNextRef } = useRefresh();
  const ref = useRef<HTMLButtonElement>(null);
  const pending = isPending(phase);
  useLayoutEffect(() => {
    const el = ref.current;
    if (focusNextRef.current && el !== null) {
      focusNextRef.current = false;
      el.focus();
    }
    // Still in the document during a layout cleanup: was it focused when it went?
    // A replacement mounts in the same commit; if none does, the flag must not reach a later one.
    return () => {
      if (el !== null && document.activeElement === el) {
        focusNextRef.current = true;
        window.setTimeout(() => {
          focusNextRef.current = false;
        }, 0);
      }
    };
  }, [focusNextRef]);
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Hent data nu"
      title="Hent data nu"
      aria-disabled={pending ? true : undefined}
      onClick={pending ? undefined : start}
      className={`group -my-3.5 -mr-3.5 -ml-2 inline-flex size-11 shrink-0 items-center justify-center align-middle outline-none active:opacity-85 ${
        attention || pending ? "text-text" : "text-text-muted hover:text-text"
      }`}
    >
      <span className="flex size-7 items-center justify-center rounded-full group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus">
        <Icon name="refresh" size={16} className={pending ? "motion-safe:animate-[spin_1.2s_linear_infinite]" : undefined} />
      </span>
    </button>
  );
}

/** The one polite status region under the updated line: always in the DOM, empty when idle. */
export function RefreshStatus() {
  const { phase } = useRefresh();
  const message = refreshMessage(phase, clock);
  return (
    <div role="status" aria-live="polite">
      {message === null ? null : message.warning ? (
        <WarningLine>{message.text}</WarningLine>
      ) : (
        <p className="font-mono text-12 text-text-muted">{message.text}</p>
      )}
    </div>
  );
}

/** Keeps the ↻ on the line of the text's last word, so it never wraps alone (refresh.md §1). */
export function WithRefresh({ text, attention }: { readonly text: string; readonly attention: boolean }) {
  const cut = text.lastIndexOf(" ") + 1;
  return (
    <>
      {text.slice(0, cut)}
      <span className="whitespace-nowrap">
        {text.slice(cut)}
        <RefreshButton attention={attention} />
      </span>
    </>
  );
}
