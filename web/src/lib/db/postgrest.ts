import "server-only";

/**
 * Minimal read-only PostgREST client (no supabase-js). Mirrors
 * python/src/training_load/db/client.py:
 *  - Auth: `apikey: <key>` always; `Authorization: Bearer <key>` only for legacy JWT keys
 *    (prefix "eyJ"). New sb_secret_ keys go in apikey only.
 *  - Reads page with limit/offset under a unique `order` and stop on the exact total from
 *    `Content-Range` (`Prefer: count=exact`), never on a short page: the server cap
 *    (max_rows = 1000) may be smaller than PAGE_SIZE.
 *  - Every request uses `cache: "no-store"`.
 * `fetch` is injected so pagination is unit-testable with a fake.
 */

export const PAGE_SIZE = 1000;
export const LEGACY_JWT_PREFIX = "eyJ";
/** Same bound as the Python client (http.DEFAULT_TIMEOUT_S): a hung Supabase fails the page fast. */
export const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type PostgrestClient = {
  readonly restUrl: string; // `${SUPABASE_URL without trailing slash}/rest/v1`
  readonly key: string;
  readonly fetch: FetchLike;
};

/** A PostgREST filter pair, e.g. ["date", "gte.2026-01-01"]. */
export type Filter = readonly [column: string, expression: string];

export type SelectQuery = {
  readonly columns: string; // PostgREST `select`, e.g. "date,ctl,atl"
  readonly order: string; // must be unique across rows, e.g. the primary key
  readonly filters?: readonly Filter[];
};

/** HTTP or protocol failure. Message names the table and status; never the key or body. */
export class PostgrestError extends Error {
  readonly table: string;
  readonly status: number | null;
  constructor(table: string, status: number | null, message: string, options?: ErrorOptions) {
    super(message, options);
    this.table = table;
    this.status = status;
  }
}

export function createClient(supabaseUrl: string, key: string, fetch: FetchLike): PostgrestClient {
  return { restUrl: `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`, key, fetch };
}

/** apikey always; Authorization: Bearer only when `key` starts with LEGACY_JWT_PREFIX. */
export function authHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith(LEGACY_JWT_PREFIX)) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** Total from `Content-Range: 0-999/1234` or `*\/0`. PostgrestError when absent/not exact. */
export function contentRangeTotal(table: string, header: string | null): number {
  const total = (header ?? "").split("/").pop() ?? "";
  if (!/^\d+$/.test(total)) {
    throw new PostgrestError(table, null, `${table}: response lacks an exact Content-Range total`);
  }
  return Number(total);
}

/**
 * All rows of `table` matching `query`, across pages, each passed through `parseRow`
 * (which throws on a malformed row). Headers: authHeaders + Accept: application/json +
 * Prefer: count=exact. PostgrestError on non-2xx, missing total, or an empty page before
 * the total is reached.
 */
export async function selectAll<T>(
  client: PostgrestClient,
  table: string,
  query: SelectQuery,
  parseRow: (raw: unknown) => T,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const params = new URLSearchParams({ select: query.columns });
    for (const [column, expression] of query.filters ?? []) params.append(column, expression);
    params.set("order", query.order);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(rows.length));

    let response: Response;
    try {
      response = await client.fetch(`${client.restUrl}/${table}?${params.toString()}`, {
        method: "GET",
        headers: { ...authHeaders(client.key), Accept: "application/json", Prefer: "count=exact" },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new PostgrestError(table, null, `${table}: request failed`, { cause });
    }
    if (!response.ok) {
      throw new PostgrestError(table, response.status, `${table}: HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new PostgrestError(table, response.status, `${table}: invalid JSON`, { cause });
    }
    if (!Array.isArray(body)) {
      throw new PostgrestError(table, response.status, `${table}: expected a JSON array`);
    }
    const page: readonly unknown[] = body;
    const total = contentRangeTotal(table, response.headers.get("content-range"));
    for (const raw of page) rows.push(parseRow(raw));
    if (rows.length >= total) return rows;
    if (page.length === 0) {
      throw new PostgrestError(
        table,
        response.status,
        `${table}: pagination stopped at ${rows.length}/${total}`,
      );
    }
  }
}
