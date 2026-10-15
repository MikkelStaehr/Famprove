import "server-only";

import { parseRuns, type WorkflowRun } from "../refresh.ts";

/**
 * The daily workflow on GitHub, for "Hent data nu" (slice refresh-button): list its runs and
 * dispatch it on main. The only code that holds GITHUB_DISPATCH_TOKEN, a fine-grained token for
 * this one repository with Actions read and write (nothing else), set in Vercel's server env
 * (Production) and never NEXT_PUBLIC_. Errors name the step and status, never the token or a body.
 * `fetch` is injected so the requests are unit-testable with a fake.
 */

export const REPO = "MikkelStaehr/Famprove";
export const WORKFLOW = "daily.yml";
const API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;
/** A hung GitHub fails the tap fast (the client shows `error`). */
export const GITHUB_TIMEOUT_MS = 10_000;
/** Enough to see every run of the last 5 minutes (at most a few per hour). */
const RUNS_PAGE = 20;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class GithubError extends Error {}

/** GITHUB_DISPATCH_TOKEN trimmed; null when missing (the route answers `unavailable`). */
export function readGithubToken(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const token = (env.GITHUB_DISPATCH_TOKEN ?? "").trim();
  return token === "" ? null : token;
}

function headers(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "training-app-refresh",
  };
}

/** The workflow's latest runs, newest first (GitHub's order); unreadable ones are logged by count. */
export async function listRuns(token: string, fetchFn: FetchLike = fetch): Promise<WorkflowRun[]> {
  const res = await fetchFn(`${API}/runs?per_page=${RUNS_PAGE}`, {
    method: "GET",
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!res.ok) throw new GithubError(`GitHub runs: HTTP ${res.status}`);
  const { runs, dropped } = parseRuns(await res.json());
  if (dropped > 0) console.warn("GitHub runs: %d unreadable runs left out", dropped);
  return runs;
}

/** Starts the workflow on main without inputs: a manual run, which the gate always runs. */
export async function dispatchDaily(token: string, fetchFn: FetchLike = fetch): Promise<void> {
  const res = await fetchFn(`${API}/dispatches`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!res.ok) throw new GithubError(`GitHub dispatch: HTTP ${res.status}`);
}
