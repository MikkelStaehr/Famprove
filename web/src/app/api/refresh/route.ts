import { devSwitchOn } from "@/lib/db/dev-fixture";
import { dispatchDaily, listRuns, readGithubToken } from "@/lib/github/workflow";
import {
  parseSince,
  type RefreshAnswer,
  refreshDecision,
  type RefreshStatus,
  refreshStatus,
  runningSince,
  sameOrigin,
} from "@/lib/refresh";

/**
 * "Hent data nu" (user, 2026-10-15, slice refresh-button; spec design/specs/refresh.md).
 * POST starts the daily workflow (collect + compute) at most once at a time and 5 minutes apart
 * (lib/refresh.ts); GET ?since= tells the client when that run has finished. It writes nothing
 * itself: the workflow's own jobs do, as at 05, 12 and 20. Behind Vercel Authentication like
 * every page; same-origin only (a route handler has no Server Action CSRF check); the token
 * never leaves lib/github/workflow.ts, and no GitHub error text reaches the client.
 */

/**
 * This instance's last dispatch: GitHub lists a new run a few seconds after the 204, so a second
 * tap in that gap must not start another (two instances can still both start one; a duplicate
 * run is harmless, the collectors are idempotent).
 */
let lastStart: number | null = null;

function answer(body: RefreshAnswer | RefreshStatus, status: number, extra: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers)) return answer({ kind: "error" }, 403);
  const token = readGithubToken();
  if (token === null || devSwitchOn()) return answer({ kind: "unavailable" }, 503);
  let runs;
  try {
    runs = await listRuns(token);
  } catch (e) {
    console.error("refresh: %s", e instanceof Error ? e.message : "unknown error");
    return answer({ kind: "error" }, 502);
  }
  // Synchronous from here to the claim: two taps in one instance can't both pass.
  const now = Date.now();
  const decision = refreshDecision(runs, now, lastStart);
  if (decision.kind === "running") return answer({ kind: "running", since: runningSince(runs, now) }, 409);
  if (decision.kind === "wait") {
    return answer({ kind: "wait", seconds: decision.seconds }, 429, { "Retry-After": String(decision.seconds) });
  }
  const previous = lastStart;
  lastStart = now;
  try {
    await dispatchDaily(token);
  } catch (e) {
    lastStart = previous;
    console.error("refresh: %s", e instanceof Error ? e.message : "unknown error");
    return answer({ kind: "error" }, 502);
  }
  return answer({ kind: "started", since: now }, 202);
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers)) return answer({ kind: "pending" }, 403);
  const since = parseSince(new URL(request.url).searchParams.get("since"), Date.now());
  const token = readGithubToken();
  if (since === null || token === null) return answer({ kind: "pending" }, 400);
  try {
    return answer(refreshStatus(await listRuns(token), since), 200);
  } catch (e) {
    console.error("refresh status: %s", e instanceof Error ? e.message : "unknown error");
    return answer({ kind: "pending" }, 502);
  }
}
