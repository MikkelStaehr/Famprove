import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseRefreshAnswer,
  parseRefreshStatus,
  parseRuns,
  parseSince,
  phaseAfter,
  POLL_LIMIT_MS,
  REFRESH_SPACING_MS,
  refreshDecision,
  refreshMessage,
  refreshStatus,
  runningSince,
  sameOrigin,
  SINCE_MAX_AGE_MS,
  START_SKEW_MS,
  type WorkflowRun,
} from "../src/lib/refresh.ts";

const NOW = Date.parse("2026-10-15T08:00:00Z");
const run = (minutesAgo: number, status = "completed", conclusion: string | null = "success", event = "workflow_dispatch"): WorkflowRun => ({
  event,
  status,
  conclusion: status === "completed" ? conclusion : null,
  createdAt: NOW - minutesAgo * 60_000,
});

test("parseRuns keeps well-typed runs and drops the rest; no workflow_runs is an error", () => {
  const { runs, dropped } = parseRuns({
    workflow_runs: [
      { event: "schedule", status: "completed", conclusion: "success", created_at: "2026-10-15T07:00:00Z" },
      { event: "workflow_dispatch", status: "queued", conclusion: null, created_at: "2026-10-15T07:59:00Z" },
      { event: 1, status: "completed", conclusion: "success", created_at: "2026-10-15T07:00:00Z" },
      { event: "schedule", status: "completed", conclusion: 5, created_at: "2026-10-15T07:00:00Z" },
      { event: "schedule", status: "completed", conclusion: null, created_at: "not a date" },
      null,
    ],
  });
  assert.deepEqual(runs.map((r) => [r.event, r.status]), [["schedule", "completed"], ["workflow_dispatch", "queued"]]);
  assert.equal(dropped, 4); // counted, so the route logs them
  assert.throws(() => parseRuns({ message: "Bad credentials" }));
  assert.throws(() => parseRuns(null));
});

test("one run at a time: anything not completed blocks, whatever its event", () => {
  for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
    assert.deepEqual(refreshDecision([run(30, status, null, "schedule")], NOW, null), { kind: "running" });
  }
});

test("5 minutes between runs, counted from the newest run of any event or this instance's own start", () => {
  assert.deepEqual(refreshDecision([run(4)], NOW, null), { kind: "wait", seconds: 60 });
  assert.deepEqual(refreshDecision([run(2, "completed", "success", "schedule")], NOW, null), { kind: "wait", seconds: 180 });
  assert.deepEqual(refreshDecision([run(5)], NOW, null), { kind: "go" });
  assert.deepEqual(refreshDecision([], NOW, null), { kind: "go" });
  // GitHub doesn't list the run yet: the local start still blocks a second tap.
  assert.deepEqual(refreshDecision([run(30)], NOW, NOW - 3_000), { kind: "wait", seconds: (REFRESH_SPACING_MS - 3_000) / 1000 });
  assert.deepEqual(refreshDecision([run(30)], NOW, NOW - REFRESH_SPACING_MS), { kind: "go" });
});

test("status follows every run created since the start (less the skew)", () => {
  const since = NOW - 60_000;
  assert.deepEqual(refreshStatus([run(30)], since), { kind: "pending" });
  assert.deepEqual(refreshStatus([run(0.5, "in_progress")], since), { kind: "running" });
  assert.deepEqual(refreshStatus([run(0.5)], since), { kind: "success" });
  assert.deepEqual(refreshStatus([run(0.5, "completed", "failure")], since), { kind: "failure" });
  assert.deepEqual(refreshStatus([run(0.5), run(0.2, "completed", "cancelled", "schedule")], since), { kind: "failure" });
  assert.deepEqual(refreshStatus([{ ...run(0), createdAt: since - START_SKEW_MS }], since), { kind: "success" });
  assert.deepEqual(refreshStatus([{ ...run(0), createdAt: since - START_SKEW_MS - 1 }], since), { kind: "pending" });
});

test("a joined run is followed from the oldest unfinished run", () => {
  assert.equal(runningSince([run(1, "in_progress"), run(9, "queued"), run(20)], NOW), NOW - 9 * 60_000);
  assert.equal(runningSince([run(20)], NOW), NOW);
});

test("same-origin: Sec-Fetch-Site or Origin must be present and match", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(sameOrigin(h({ "sec-fetch-site": "same-origin", origin: "https://app.example", host: "app.example" })), true);
  assert.equal(sameOrigin(h({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameOrigin(h({ origin: "https://app.example", host: "app.example" })), true);
  assert.equal(sameOrigin(h({ "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "app.example" })), false);
  assert.equal(sameOrigin(h({ "sec-fetch-site": "same-site" })), false);
  assert.equal(sameOrigin(h({ origin: "https://evil.example", host: "app.example" })), false);
  assert.equal(sameOrigin(h({ origin: "null", host: "app.example" })), false);
  assert.equal(sameOrigin(h({ host: "app.example" })), false);
});

test("?since= is digits within the last 30 minutes", () => {
  assert.equal(parseSince(String(NOW - 60_000), NOW), NOW - 60_000);
  assert.equal(parseSince(String(NOW - SINCE_MAX_AGE_MS), NOW), NOW - SINCE_MAX_AGE_MS);
  assert.equal(parseSince(String(NOW - SINCE_MAX_AGE_MS - 1), NOW), null);
  assert.equal(parseSince(String(NOW + 120_000), NOW), null);
  for (const raw of [null, "", "-5", "1e12", "12.5", "abc", "9".repeat(16)]) assert.equal(parseSince(raw, NOW), null);
});

test("the client reads answers defensively: anything odd is error / pending", () => {
  assert.deepEqual(parseRefreshAnswer({ kind: "started", since: NOW }), { kind: "started", since: NOW });
  assert.deepEqual(parseRefreshAnswer({ kind: "running", since: NOW }), { kind: "running", since: NOW });
  assert.deepEqual(parseRefreshAnswer({ kind: "wait", seconds: 61 }), { kind: "wait", seconds: 61 });
  assert.deepEqual(parseRefreshAnswer({ kind: "unavailable" }), { kind: "unavailable" });
  for (const odd of [null, "x", { kind: "started" }, { kind: "wait", seconds: "5" }, { kind: "started", since: -1 }, { kind: "nope" }]) {
    assert.deepEqual(parseRefreshAnswer(odd), { kind: "error" });
  }
  assert.deepEqual(parseRefreshStatus({ kind: "success" }), { kind: "success" });
  assert.deepEqual(parseRefreshStatus({ kind: "weird" }), { kind: "pending" });
  assert.deepEqual(parseRefreshStatus(null), { kind: "pending" });
});

test("refresh.md §3: every outcome's words and kind", () => {
  const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16).replace(":", ".");
  const msg = (p: Parameters<typeof refreshMessage>[0]) => refreshMessage(p, clock);
  assert.equal(msg({ kind: "idle" }), null);
  assert.deepEqual(msg({ kind: "sending" }), { text: "henter data …", warning: false });
  const started = phaseAfter({ kind: "started", since: NOW }, NOW);
  assert.deepEqual(started, { kind: "polling", since: NOW, joined: false, until: NOW + POLL_LIMIT_MS });
  assert.deepEqual(msg(started), { text: "henter data … ca. 1 min", warning: false });
  assert.deepEqual(msg(phaseAfter({ kind: "running", since: NOW - 1 }, NOW)), { text: "en hentning kører allerede · venter på den", warning: false });
  assert.deepEqual(msg({ kind: "done" }), { text: "data hentet", warning: false });
  // 61 s after 08:00:00 rounds up to 08.02, never a countdown.
  assert.deepEqual(msg(phaseAfter({ kind: "wait", seconds: 61 }, NOW)), { text: "hentet for nylig · kan hentes igen kl. 08.02", warning: false });
  assert.deepEqual(msg(phaseAfter({ kind: "wait", seconds: 60 }, NOW)), { text: "hentet for nylig · kan hentes igen kl. 08.01", warning: false });
  assert.deepEqual(msg({ kind: "unavailable" }), { text: "hentning er ikke slået til her · data hentes kl. 05, 12 og 20", warning: false });
  assert.equal(msg({ kind: "error" })?.warning, true);
  assert.equal(msg({ kind: "error" })?.text, "Hentningen kunne ikke startes, fordi GitHub ikke svarede. Prøv igen om lidt.");
  assert.equal(msg({ kind: "failed" })?.text, "Hentningen fejlede, så tallene er uændrede. Prøv igen, eller vent på kl. 05, 12 eller 20.");
  assert.deepEqual(msg({ kind: "timeout" }), { text: "intet svar efter 5 min · genindlæs siden senere", warning: false });
});
