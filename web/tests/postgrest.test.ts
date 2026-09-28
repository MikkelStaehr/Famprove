import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authHeaders,
  contentRangeTotal,
  createClient,
  PostgrestError,
  selectAll,
} from "../src/lib/db/postgrest.ts";
import type { FetchLike } from "../src/lib/db/postgrest.ts";

type Call = { readonly url: URL; readonly init: RequestInit };

/** Serves ids 0..total-1, at most `cap` rows per response (the server's max_rows). */
function pagedFetch(total: number, cap: number, calls: Call[]): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    const offset = Number(parsed.searchParams.get("offset"));
    const limit = Math.min(Number(parsed.searchParams.get("limit")), cap);
    const page = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      id: offset + i,
    }));
    const range = page.length ? `${offset}-${offset + page.length - 1}/${total}` : `*/${total}`;
    return new Response(JSON.stringify(page), { headers: { "Content-Range": range } });
  };
}

function parseId(raw: unknown): number {
  if (typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "number") {
    return raw.id;
  }
  throw new Error("bad row");
}

test("authHeaders: legacy JWT gets Bearer, sb_secret_ key goes in apikey only", () => {
  assert.deepEqual(authHeaders("eyJabc"), { apikey: "eyJabc", Authorization: "Bearer eyJabc" });
  assert.deepEqual(authHeaders("sb_secret_x"), { apikey: "sb_secret_x" });
});

test("contentRangeTotal reads the exact total and rejects unknown totals", () => {
  assert.equal(contentRangeTotal("t", "0-999/1234"), 1234);
  assert.equal(contentRangeTotal("t", "*/0"), 0);
  assert.throws(() => contentRangeTotal("t", "0-9/*"), PostgrestError);
  assert.throws(() => contentRangeTotal("t", null), PostgrestError);
});

for (const [total, cap] of [
  [0, 1000],
  [2500, 1000],
  [2500, 300],
] as const) {
  test(`selectAll paginates to the Content-Range total (total ${total}, server cap ${cap})`, async () => {
    const calls: Call[] = [];
    const client = createClient("https://x.supabase.co/", "sb_secret_k", pagedFetch(total, cap, calls));
    const rows = await selectAll(client, "daily_load", { columns: "id", order: "id" }, parseId);
    assert.deepEqual(rows, Array.from({ length: total }, (_, i) => i));
    const first = calls[0];
    assert.ok(first);
    assert.equal(first.url.origin + first.url.pathname, "https://x.supabase.co/rest/v1/daily_load");
    assert.equal(first.url.searchParams.get("order"), "id");
    assert.equal(first.init.cache, "no-store");
    assert.equal(first.init.method, "GET");
    const headers = new Headers(first.init.headers);
    assert.equal(headers.get("prefer"), "count=exact");
    assert.equal(headers.get("apikey"), "sb_secret_k");
  });
}

test("selectAll turns HTTP errors into PostgrestError without leaking the body", async () => {
  const failing: FetchLike = async () => new Response('{"message":"secret detail"}', { status: 401 });
  const client = createClient("https://x.supabase.co", "k", failing);
  await assert.rejects(
    selectAll(client, "blocks", { columns: "name", order: "name" }, parseId),
    (err: unknown) =>
      err instanceof PostgrestError &&
      err.status === 401 &&
      err.message === "blocks: HTTP 401" &&
      !err.message.includes("secret"),
  );
});

test("selectAll refuses a non-array body and an early empty page", async () => {
  const notArray: FetchLike = async () =>
    new Response('{"a":1}', { headers: { "Content-Range": "0-0/1" } });
  await assert.rejects(
    selectAll(createClient("https://x.supabase.co", "k", notArray), "t", { columns: "id", order: "id" }, parseId),
    /expected a JSON array/,
  );
  const shortServer: FetchLike = async () =>
    new Response("[]", { headers: { "Content-Range": "*/5" } });
  await assert.rejects(
    selectAll(createClient("https://x.supabase.co", "k", shortServer), "t", { columns: "id", order: "id" }, parseId),
    /pagination stopped at 0\/5/,
  );
});
