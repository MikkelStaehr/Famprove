/**
 * tab-perf-probe (local only, never sent anywhere): how long a switch takes on the phone itself.
 * Per switch (tab tap, swipe, back/forward; Minimér → /train; Begynd/Fortsæt → /fokus):
 * - tapToContent: from the pointerdown (a swipe: its release; back/forward: the popstate) to the
 *   second frame after the target's ready signal (a tab: its page frame `data-active` and visible;
 *   /fokus: FokusScreen's first commit, `perfReady("/fokus")`);
 * - tapToSettled: to the shell's animation end (TabShell calls `perfSettled`), at most 1 s after the
 *   content; a switch with no shell animation (Minimér, Begynd) settles with its content;
 * - serverRequests: same-origin fetch/navigation/_rsc resources started after the tap and seen by a
 *   PerformanceObserver until the later of settled and 1 s after the tap.
 * The last 50 live in localStorage `famprove.perf`. No work unless a switch happens.
 */

export type PerfKind = "tab" | "minimise" | "begin";

export type PerfEntry = {
  readonly kind: PerfKind;
  readonly from: string;
  readonly to: string;
  /** Wall clock of the tap, ISO. */
  readonly at: string;
  /** ms; null = the content never showed within 5 s. */
  readonly tapToContent: number | null;
  /** ms; null = never settled (content never showed). */
  readonly tapToSettled: number | null;
  readonly serverRequests: number;
};

export const PERF_KEY = "famprove.perf";
export const PERF_CAP = 50;
export const PERF_KINDS: readonly PerfKind[] = ["tab", "minimise", "begin"];
/** The event the long-press / Shift+P sends; PerfSheet opens on it. */
export const PERF_OPEN_EVENT = "famprove:perf-open";

/** The list with `entry` appended, the oldest dropped beyond `cap`. */
export function capEntries(list: readonly PerfEntry[], entry: PerfEntry, cap: number = PERF_CAP): PerfEntry[] {
  return [...list, entry].slice(-cap);
}

/** Median of the numbers (mean of the middle two when even); null for none. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export type KindMedian = {
  readonly n: number;
  readonly tapToContent: number | null;
  readonly tapToSettled: number | null;
  readonly serverRequests: number | null;
};

/** Per kind: the count and the median of each measure (nulls left out). */
export function mediansByKind(entries: readonly PerfEntry[]): Record<PerfKind, KindMedian> {
  const out = {} as Record<PerfKind, KindMedian>;
  for (const kind of PERF_KINDS) {
    const of = entries.filter((e) => e.kind === kind);
    out[kind] = {
      n: of.length,
      tapToContent: median(of.flatMap((e) => (e.tapToContent === null ? [] : [e.tapToContent]))),
      tapToSettled: median(of.flatMap((e) => (e.tapToSettled === null ? [] : [e.tapToSettled]))),
      serverRequests: median(of.map((e) => e.serverRequests)),
    };
  }
  return out;
}

const ms = (v: number | null): string => (v === null ? "–" : `${Math.round(v)} ms`);

/** Plain text for Kopiér: the medians per kind, then one line per entry, newest last. */
export function formatPerf(entries: readonly PerfEntry[]): string {
  const med = mediansByKind(entries);
  const lines = [`famprove.perf · ${entries.length} målinger`];
  for (const kind of PERF_KINDS) {
    const m = med[kind];
    if (m.n === 0) continue;
    lines.push(`median ${kind} (n=${m.n}): indhold ${ms(m.tapToContent)} · færdig ${ms(m.tapToSettled)} · kald ${m.serverRequests ?? "–"}`);
  }
  for (const e of entries) {
    lines.push(`${e.at} ${e.kind} ${e.from}→${e.to} ${ms(e.tapToContent)} ${ms(e.tapToSettled)} ${e.serverRequests} kald`);
  }
  return lines.join("\n");
}

const APP_PATHS = ["/train", "/load", "/analyse", "/fokus", "/kamera", "/api/"];

/**
 * A resource the switch asked the server for: same origin, not a static asset, and either an RSC
 * payload (`_rsc` in the URL) or a fetch/navigation/xhr to one of the app's paths.
 */
export function isServerRequest(url: string, initiatorType: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (u.pathname.startsWith("/_next/static/")) return false;
  if (u.search.includes("_rsc") || u.href.includes("_rsc=")) return true;
  if (initiatorType !== "fetch" && initiatorType !== "navigation" && initiatorType !== "xmlhttprequest") return false;
  return u.pathname === "/" || APP_PATHS.some((p) => u.pathname === p || u.pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export function readPerf(): PerfEntry[] {
  try {
    const raw = window.localStorage.getItem(PERF_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PerfEntry[]) : []; // our own writes only
  } catch {
    return [];
  }
}

export function clearPerf(): void {
  try {
    window.localStorage.removeItem(PERF_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

function store(entry: PerfEntry): void {
  try {
    window.localStorage.setItem(PERF_KEY, JSON.stringify(capEntries(readPerf(), entry)));
  } catch {
    // Storage full or blocked: the measurement is dropped, nothing else changes.
  }
}

// ---- Runtime (browser only) ----

type Pending = {
  kind: PerfKind;
  from: string;
  to: string;
  at: string;
  t0: number;
  content: number | null;
  settled: number | null;
  requests: number;
  observer: PerformanceObserver | null;
  timers: number[];
  done: boolean;
};

let lastDown = Number.NEGATIVE_INFINITY;
let lastPop = Number.NEGATIVE_INFINITY;
let t0Next: number | null = null;
let current: Pending | null = null;
const signalled = new Set<string>();

/** The next switch starts at `t` (a swipe's release) instead of the last pointerdown. */
export function perfStartAt(t: number): void {
  t0Next = t;
}

/** The next switch starts now: Minimér and Begynd call it at the tap, before their save (review). */
export function perfMarkTap(): void {
  if (typeof performance !== "undefined") t0Next = performance.now();
}

/** A target with no DOM signal (FokusScreen) says it rendered. */
export function perfReady(path: string): void {
  signalled.add(path);
}

/** The shell's animation ended. */
export function perfSettled(): void {
  const c = current;
  if (c === null || c.done || c.kind !== "tab") return;
  c.settled = performance.now();
  maybeFinish(c);
}

function isReady(to: string): boolean {
  if (signalled.has(to)) return true;
  const el = document.querySelector<HTMLElement>(`[data-tab-page="${to}"][data-active]`);
  return el !== null && el.style.visibility !== "hidden";
}

function finish(c: Pending): void {
  if (c.done) return;
  c.done = true;
  for (const t of c.timers) window.clearTimeout(t);
  if (c.observer !== null) {
    count(c, c.observer.takeRecords());
    c.observer.disconnect();
  }
  // No end signal (cut by the next switch, or the 1 s fallback): settled when finished.
  const settledAt = c.content === null ? null : Math.max(c.settled ?? performance.now(), c.content);
  store({
    kind: c.kind,
    from: c.from,
    to: c.to,
    at: c.at,
    tapToContent: c.content === null ? null : Math.round(c.content - c.t0),
    tapToSettled: settledAt === null ? null : Math.round(settledAt - c.t0),
    serverRequests: c.requests,
  });
  if (current === c) current = null;
}

function maybeFinish(c: Pending): void {
  if (c.done || c.content === null) return;
  if (c.kind === "tab" && c.settled === null) return;
  const wait = c.t0 + 1000 - performance.now();
  if (wait <= 0) finish(c);
  else c.timers.push(window.setTimeout(() => finish(c), wait));
}

function count(c: Pending, list: readonly PerformanceEntry[]): void {
  for (const e of list) {
    const r = e as PerformanceResourceTiming; // type "resource" only
    if (r.startTime >= c.t0 - 1 && isServerRequest(r.name, r.initiatorType, window.location.origin)) c.requests += 1;
  }
}

/** A switch from `from` to `to` began (at the last tap, a swipe's release, or the popstate). */
export function perfStart(kind: PerfKind, from: string, to: string): void {
  if (typeof window === "undefined") return;
  const now = performance.now();
  if (current !== null) finish(current);
  // A tap's own start (perfStartAt: Minimér and Begynd mark it before their save) counts within 30 s;
  // an older one is stale (a refused Minimér, review) and never times an unrelated switch.
  const marked = t0Next !== null && now - t0Next < 30_000 ? t0Next : null;
  const t0 = marked ?? (now - lastDown < 1500 ? lastDown : now - lastPop < 1500 ? lastPop : now);
  t0Next = null;
  signalled.delete(to);
  const c: Pending = { kind, from, to, at: new Date().toISOString(), t0, content: null, settled: null, requests: 0, observer: null, timers: [], done: false };
  current = c;
  try {
    c.observer = new PerformanceObserver((list) => count(c, list.getEntries()));
    // buffered: the requests since t0 too (a save that ran between the tap and this start), filtered by count().
    c.observer.observe({ type: "resource", buffered: true });
  } catch {
    c.observer = null; // no observer: the count stays 0
  }
  const deadline = now + 5000;
  const poll = () => {
    if (c.done) return;
    if (isReady(to)) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (c.done) return;
          c.content = performance.now();
          if (c.kind !== "tab") c.settled = c.content; // no shell animation: settles with its content
          // The shell's animation, if it never says it ended: settled 1 s after the content.
          if (c.kind === "tab") c.timers.push(window.setTimeout(() => finish(c), 1000));
          maybeFinish(c);
        }),
      );
      return;
    }
    if (performance.now() > deadline) {
      finish(c);
      return;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

let installed = false;

/** The page-wide listeners (tap time, popstate, the long-press on "opdateret", Shift+P), once. */
export function installPerfProbe(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  let hold = 0;
  let holdAt = { x: 0, y: 0 };
  const open = () => window.dispatchEvent(new Event(PERF_OPEN_EVENT));
  const onUpdatedLine = (t: EventTarget | null): boolean =>
    t instanceof Element && t.closest("button, a") === null && (t.closest("p")?.textContent ?? "").includes("opdateret");
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastDown = performance.now();
      window.clearTimeout(hold);
      if (!onUpdatedLine(e.target)) return;
      holdAt = { x: e.clientX, y: e.clientY };
      hold = window.setTimeout(open, 600);
    },
    { capture: true, passive: true },
  );
  window.addEventListener("pointerup", () => window.clearTimeout(hold), { capture: true, passive: true });
  window.addEventListener(
    "pointermove",
    (e) => {
      if (Math.abs(e.clientX - holdAt.x) > 10 || Math.abs(e.clientY - holdAt.y) > 10) window.clearTimeout(hold);
    },
    { capture: true, passive: true },
  );
  // Android's own long-press (text selection / menu) on the line opens the sheet instead.
  window.addEventListener("contextmenu", (e) => {
    if (!onUpdatedLine(e.target)) return;
    e.preventDefault();
    window.clearTimeout(hold);
    open();
  });
  window.addEventListener("popstate", () => {
    lastPop = performance.now();
  });
  window.addEventListener("keydown", (e) => {
    if (!e.shiftKey || e.key.toLowerCase() !== "p" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.closest("input, textarea, select") !== null)) return;
    open();
  });
}
