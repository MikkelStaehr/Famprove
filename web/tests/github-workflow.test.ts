import assert from "node:assert/strict";
import { test } from "node:test";

import { dispatchDaily, GithubError, listRuns, readGithubToken } from "../src/lib/github/workflow.ts";

type Call = { url: string; init: RequestInit };

function fake(status: number, body: unknown = {}): { calls: Call[]; fetch: (url: string, init: RequestInit) => Promise<Response> } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    },
  };
}

test("the token is GITHUB_DISPATCH_TOKEN trimmed; missing or blank is null", () => {
  assert.equal(readGithubToken({ GITHUB_DISPATCH_TOKEN: "  github_pat_x \n" }), "github_pat_x");
  assert.equal(readGithubToken({ GITHUB_DISPATCH_TOKEN: "  " }), null);
  assert.equal(readGithubToken({}), null);
});

test("dispatch: POST to daily.yml's dispatches on main, no inputs (a manual run always runs)", async () => {
  const f = fake(204);
  await dispatchDaily("tok", f.fetch);
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, "https://api.github.com/repos/MikkelStaehr/Famprove/actions/workflows/daily.yml/dispatches");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(String(init.body)), { ref: "main" });
  assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tok");
  assert.equal(init.cache, "no-store");
  assert.ok(init.signal instanceof AbortSignal);
});

test("runs: GET daily.yml's runs, parsed", async () => {
  const f = fake(200, { workflow_runs: [{ event: "schedule", status: "completed", conclusion: "success", created_at: "2026-10-15T07:00:00Z" }] });
  const runs = await listRuns("tok", f.fetch);
  assert.match(f.calls[0].url, /\/actions\/workflows\/daily\.yml\/runs\?per_page=\d+$/);
  assert.equal(runs.length, 1);
});

test("a refused request names the step and status, never the token or the body", async () => {
  for (const call of [() => dispatchDaily("secret-token", fake(403, { message: "Resource not accessible" }).fetch), () => listRuns("secret-token", fake(401, { message: "Bad credentials" }).fetch)]) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(e instanceof GithubError);
      assert.match(e.message, /HTTP 40[13]$/);
      assert.ok(!e.message.includes("secret-token") && !e.message.includes("credentials") && !e.message.includes("accessible"));
      return true;
    });
  }
});
