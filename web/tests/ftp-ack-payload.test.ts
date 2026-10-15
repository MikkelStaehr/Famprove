import assert from "node:assert/strict";
import { test } from "node:test";

import { recordFtpChoice } from "../src/lib/db/ftp-ack.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";

// Tester's addition (slice ftp-confirm, criterion 8): the insert the server sends to PostgREST is
// exactly { choice, ftp_w, eftp_w } with the server's W values; `at` is never in the payload.
const STATUS = { singleton: true, ftp_w: 230, eftp_w: 183, credible: true, last_tested_on: "2026-10-04", ftp_since: "2026-03-21", suppressed_until: null };
const NOTICE = { kind: "ftp_mismatch", date: "2026-10-15", message: "FTP er sat til 230 W, men dine ture peger på 183 W", updated_at: "2026-10-15T03:00:00+00:00" };

test("the choose payload carries no `at` and no client values: one POST of choice, ftp_w, eftp_w", async () => {
  const posts: unknown[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    const table = new URL(url).pathname.split("/").at(-1);
    const json = (rows: unknown, status = 200) => new Response(JSON.stringify(rows), { status });
    if (init.method === "GET") return json(table === "ftp_status" ? [STATUS] : table === "app_notices" ? [NOTICE] : []);
    if (init.method === "POST") {
      const body: unknown = JSON.parse(String(init.body));
      posts.push(body);
      return json([{ id: 7, ...(body as object), at: "2026-10-15T08:00:00+00:00" }], 201);
    }
    throw new Error(`unexpected ${init.method} ${table}`);
  };
  const result = await recordFtpChoice("fixed", { env: {}, nodeEnv: "production", client: () => createClient("https://x.supabase.co", "sb_secret_x", fetchLike) });
  assert.deepEqual(result, { ok: true, id: 7 });
  assert.equal(posts.length, 1);
  const [body] = posts as Record<string, unknown>[];
  const row = Array.isArray(body) ? (body[0] as Record<string, unknown>) : body;
  assert.deepEqual(Object.keys(row).toSorted(), ["choice", "eftp_w", "ftp_w"]);
  assert.deepEqual(row, { choice: "fixed", ftp_w: 230, eftp_w: 183 });
});

test("a choice sent as an object, a number or with a forged W is refused before any request", async () => {
  let requests = 0;
  const fetchLike: FetchLike = async () => {
    requests += 1;
    return new Response("[]");
  };
  const opts = { env: {}, nodeEnv: "production", client: () => createClient("https://x.supabase.co", "sb_secret_x", fetchLike) } as const;
  for (const raw of [{ choice: "confirmed", ftp_w: 999 }, 1, "Confirmed", " fixed", null, undefined]) {
    assert.deepEqual(await recordFtpChoice(raw, opts), { ok: false, reason: "invalid" });
  }
  assert.equal(requests, 0);
});
