/**
 * "Hent data nu" (user, 2026-10-15, slice refresh-button): the pure rules behind POST/GET
 * /api/refresh. No I/O, no server-only; unit-tested with `node --test`.
 *
 * The route starts the daily workflow (daily.yml, workflow_dispatch on main, no slot: the gate
 * always runs a manual run) at most once at a time and 5 minutes apart. GitHub's own run list is
 * the state, so nothing is stored: a queued or running run blocks, and so does any run of the
 * workflow created less than REFRESH_SPACING_MS ago (the droplet's slot runs and the scheduled
 * backups count too: their data is that fresh).
 */

export const REFRESH_SPACING_MS = 5 * 60_000;
/** The client polls the status this often after a start, and gives up after POLL_LIMIT_MS. */
export const POLL_INTERVAL_MS = 10_000;
export const POLL_LIMIT_MS = 5 * 60_000;
/**
 * A dispatched run shows up in GitHub's list a few seconds after the 204; a run created this long
 * before the start still counts as ours (clock skew between Vercel and GitHub).
 */
export const START_SKEW_MS = 15_000;

/** One workflow run as the route reads it (GitHub REST: actions/workflows/{id}/runs). */
export type WorkflowRun = {
  readonly event: string; // "workflow_dispatch", "schedule", ...
  readonly status: string; // "queued", "in_progress", "completed", "waiting", "requested", "pending"
  readonly conclusion: string | null; // "success", "failure", ...; null until completed
  readonly createdAt: number; // epoch ms
};

/**
 * Narrows GitHub's JSON to runs. A run with a field of the wrong type is dropped (never guessed);
 * a body without a `workflow_runs` array is an error (the route answers `error`).
 */
export function parseRuns(json: unknown): WorkflowRun[] {
  if (typeof json !== "object" || json === null || !("workflow_runs" in json) || !Array.isArray(json.workflow_runs)) {
    throw new Error("GitHub runs: no workflow_runs array");
  }
  const runs: WorkflowRun[] = [];
  for (const r of json.workflow_runs as unknown[]) {
    if (typeof r !== "object" || r === null) continue;
    const { event, status, conclusion, created_at: created } = r as Record<string, unknown>;
    if (typeof event !== "string" || typeof status !== "string" || typeof created !== "string") continue;
    if (conclusion !== null && typeof conclusion !== "string") continue;
    const createdAt = Date.parse(created);
    if (Number.isNaN(createdAt)) continue;
    runs.push({ event, status, conclusion, createdAt });
  }
  return runs;
}

export type RefreshDecision =
  | { readonly kind: "go" }
  | { readonly kind: "running" }
  | { readonly kind: "wait"; readonly seconds: number };

/**
 * Whether a POST may dispatch now. `lastLocalStart`: this server instance's own last dispatch
 * (epoch ms), which covers the seconds before GitHub lists the new run; null = none.
 */
export function refreshDecision(runs: readonly WorkflowRun[], now: number, lastLocalStart: number | null): RefreshDecision {
  if (runs.some((r) => r.status !== "completed")) return { kind: "running" };
  const latest = Math.max(lastLocalStart ?? -Infinity, ...runs.map((r) => r.createdAt));
  const left = latest + REFRESH_SPACING_MS - now;
  return left > 0 ? { kind: "wait", seconds: Math.ceil(left / 1000) } : { kind: "go" };
}

/** What GET /api/refresh?since= answers about the runs created since a start (epoch ms). */
export type RefreshStatus =
  | { readonly kind: "pending" } // not listed yet
  | { readonly kind: "running" }
  | { readonly kind: "success" }
  | { readonly kind: "failure" };

/**
 * The runs created at or after `since` (less START_SKEW_MS), whatever their event: the one a POST
 * started, or the one it found running (design/specs/refresh.md §3: the client then waits for that
 * one). Any unfinished → running; all finished → success only if every one succeeded (a gated-out
 * backup run also ends in success).
 */
export function refreshStatus(runs: readonly WorkflowRun[], since: number): RefreshStatus {
  const ours = runs.filter((r) => r.createdAt >= since - START_SKEW_MS);
  if (ours.length === 0) return { kind: "pending" };
  if (ours.some((r) => r.status !== "completed")) return { kind: "running" };
  return ours.every((r) => r.conclusion === "success") ? { kind: "success" } : { kind: "failure" };
}

/** The oldest unfinished run's creation time: what the client polls from after a `running`. */
export function runningSince(runs: readonly WorkflowRun[], now: number): number {
  const open = runs.filter((r) => r.status !== "completed").map((r) => r.createdAt);
  return open.length === 0 ? now : Math.min(...open);
}

/** Everything POST /api/refresh answers (the client renders it; `since` anchors the polling). */
export type RefreshAnswer =
  | { readonly kind: "started"; readonly since: number }
  | { readonly kind: "running"; readonly since: number }
  | { readonly kind: "wait"; readonly seconds: number }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

/** The client's reading of a POST body: anything unexpected is `error`, never guessed. */
export function parseRefreshAnswer(json: unknown): RefreshAnswer {
  if (typeof json !== "object" || json === null) return { kind: "error" };
  const r = json as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if ((r.kind === "started" || r.kind === "running") && num(r.since)) return { kind: r.kind, since: r.since };
  if (r.kind === "wait" && num(r.seconds)) return { kind: "wait", seconds: r.seconds };
  if (r.kind === "unavailable") return { kind: "unavailable" };
  return { kind: "error" };
}

/** The client's reading of a GET body; anything unexpected is `pending` (the 5-min limit ends it). */
export function parseRefreshStatus(json: unknown): RefreshStatus {
  const kind = typeof json === "object" && json !== null ? (json as Record<string, unknown>).kind : null;
  return kind === "running" || kind === "success" || kind === "failure" ? { kind } : { kind: "pending" };
}

/** The control's state on the client (design/specs/refresh.md §2–§3). */
export type RefreshPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "polling"; readonly since: number; readonly joined: boolean; readonly until: number }
  | { readonly kind: "done" }
  | { readonly kind: "wait"; readonly until: number }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" }
  | { readonly kind: "failed" }
  | { readonly kind: "timeout" };

export function isPending(phase: RefreshPhase): boolean {
  return phase.kind === "sending" || phase.kind === "polling";
}

/** A POST answer as the next phase; `now` anchors the poll limit and the wait time. */
export function phaseAfter(answer: RefreshAnswer, now: number): RefreshPhase {
  switch (answer.kind) {
    case "started":
    case "running":
      return { kind: "polling", since: answer.since, joined: answer.kind === "running", until: now + POLL_LIMIT_MS };
    case "wait":
      return { kind: "wait", until: now + answer.seconds * 1000 };
    case "unavailable":
      return { kind: "unavailable" };
    case "error":
      return { kind: "error" };
  }
}

export type RefreshMessage = { readonly text: string; readonly warning: boolean };

/**
 * The status line's words (design/specs/refresh.md §3). `clock` formats epoch ms as a local
 * "05.17" (injected, so this stays pure); the wait time is rounded up to the minute.
 */
export function refreshMessage(phase: RefreshPhase, clock: (ms: number) => string): RefreshMessage | null {
  const neutral = (text: string) => ({ text, warning: false });
  switch (phase.kind) {
    case "idle":
      return null;
    case "sending":
      return neutral("henter data …");
    case "polling":
      return neutral(phase.joined ? "en hentning kører allerede · venter på den" : "henter data … ca. 1 min");
    case "done":
      return neutral("data hentet");
    case "wait":
      return neutral(`hentet for nylig · kan hentes igen kl. ${clock(Math.ceil(phase.until / 60_000) * 60_000)}`);
    case "unavailable":
      return neutral("hentning er ikke slået til her · data hentes kl. 05, 12 og 20");
    case "error":
      return { text: "Hentningen kunne ikke startes, fordi GitHub ikke svarede. Prøv igen om lidt.", warning: true };
    case "failed":
      return { text: "Hentningen fejlede, så tallene er uændrede. Prøv igen, eller vent på kl. 05, 12 eller 20.", warning: true };
    case "timeout":
      return neutral("intet svar efter 5 min · genindlæs siden senere");
  }
}

/**
 * A route handler gets no CSRF check from Next (a Server Action does): the POST is honoured only
 * from this site's own pages. Sec-Fetch-Site, when sent, must be same-origin; Origin, when sent,
 * must name the request's host; at least one of them must be present.
 */
export function sameOrigin(headers: { get(name: string): string | null }): boolean {
  const site = headers.get("sec-fetch-site");
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (site === null && origin === null) return false;
  if (site !== null && site !== "same-origin") return false;
  if (origin !== null) {
    if (host === null || !URL.canParse(origin) || new URL(origin).host !== host) return false;
  }
  return true;
}

/** How old a `?since=` may be: a joined run may have waited in the gate up to 15 min. */
export const SINCE_MAX_AGE_MS = 30 * 60_000;

/** `?since=` as epoch ms: digits only, within the last SINCE_MAX_AGE_MS (a minute ahead allowed). */
export function parseSince(raw: string | null, now: number): number | null {
  if (raw === null || !/^\d{1,15}$/.test(raw)) return null;
  const since = Number(raw);
  return since <= now + 60_000 && since >= now - SINCE_MAX_AGE_MS ? since : null;
}
