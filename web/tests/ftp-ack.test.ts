import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ackInsert, recordFtpChoice, undoFtpChoice, type FtpAckOptions } from "../src/lib/db/ftp-ack.ts";
import { createClient, type FetchLike } from "../src/lib/db/postgrest.ts";

// A fake PostgREST for ftp_status, app_notices and ftp_ack (slice ftp-confirm). `cutAt` throws on
// that request number (1-based) before the server sees it; `loseReplyAt` lets the server apply it
// and then throws (the reply is lost): the two partial failures a tap can meet.
type Row = Record<string, unknown>;
type Db = { status: Row | null; notice: Row | null; acks: Row[]; requests: number; writes: number; cutAt?: number; loseReplyAt?: number; clock: number };

const STATUS: Row = { singleton: true, ftp_w: 230, eftp_w: 183, credible: true, last_tested_on: "2026-10-04", ftp_since: "2026-03-21", suppressed_until: null };
const NOTICE: Row = { kind: "ftp_mismatch", date: "2026-10-15", message: "FTP er sat til 230 W, men dine ture peger på 183 W", updated_at: "2026-10-15T03:00:00+00:00" };

function db(over: Partial<Db> = {}): Db {
  return { status: STATUS, notice: NOTICE, acks: [], requests: 0, writes: 0, clock: Date.parse("2026-10-15T08:00:00Z"), ...over };
}

function fetchFor(d: Db): FetchLike {
  return async (url, init) => {
    d.requests += 1;
    if (d.cutAt === d.requests) throw new TypeError("fetch failed");
    const u = new URL(url);
    const table = u.pathname.split("/").at(-1);
    const json = (rows: unknown, status = 200) => new Response(JSON.stringify(rows), { status, headers: { "Content-Range": "0-0/1" } });
    let reply: Response;
    if (init.method === "GET") {
      if (table === "ftp_status") reply = json(d.status === null ? [] : [d.status]);
      else if (table === "app_notices") reply = json(d.notice === null ? [] : [d.notice]);
      else reply = json(d.acks.toSorted((a, b) => Number(b.id) - Number(a.id)).slice(0, 1));
    } else if (init.method === "POST" && table === "ftp_ack") {
      d.writes += 1;
      const body = JSON.parse(String(init.body)) as Row;
      d.clock += 1000;
      const row = { id: 1 + Math.max(0, ...d.acks.map((a) => Number(a.id))), ...body, at: new Date(d.clock).toISOString() };
      d.acks.push(row);
      reply = json([row], 201);
    } else if (init.method === "DELETE" && table === "ftp_ack") {
      d.writes += 1;
      const id = u.searchParams.get("id")?.replace("eq.", "");
      d.acks = d.acks.filter((a) => String(a.id) !== id);
      reply = new Response(null, { status: 204 });
    } else {
      throw new Error(`unexpected ${init.method} ${table}`);
    }
    if (d.loseReplyAt === d.requests) throw new TypeError("reply lost");
    return reply;
  };
}

const PROD = { env: {}, nodeEnv: "production" } as const;
const opts = (d: Db, extra: Partial<FtpAckOptions> = {}): FtpAckOptions => ({ ...PROD, client: () => createClient("https://x.supabase.co", "sb_secret_x", fetchFor(d)), ...extra });

test("a choice is one insert of the server's W values, never the client's time", async () => {
  const d = db();
  assert.deepEqual(await recordFtpChoice("confirmed", opts(d)), { ok: true, id: 1 });
  assert.equal(d.writes, 1);
  assert.deepEqual(Object.keys(d.acks[0]).toSorted(), ["at", "choice", "eftp_w", "ftp_w", "id"]);
  assert.deepEqual([d.acks[0].choice, d.acks[0].ftp_w, d.acks[0].eftp_w], ["confirmed", 230, 183]);
});

test("refused with no write: an unknown choice, no notice, no FTP; a dev switch writes nothing and answers ok", async () => {
  for (const [raw, d] of [["maybe", db()], ["fixed", db({ notice: null })], ["fixed", db({ status: { ...STATUS, ftp_w: null } })]] as const) {
    const result = await recordFtpChoice(raw, opts(d));
    assert.equal(result.ok, false);
    assert.equal(d.writes, 0);
  }
  const dev = db();
  assert.deepEqual(await recordFtpChoice("confirmed", opts(dev, { env: { DEV_FIXTURE: "ftp-warning" }, nodeEnv: "development" })), { ok: true, id: null });
  assert.deepEqual(await undoFtpChoice(1, opts(dev, { env: { DEV_TODAY: "2026-10-15" }, nodeEnv: "development" })), { ok: true });
  assert.equal(dev.requests, 0);
});

test("Fortryd deletes that answer only while it is the newest; a gone one counts as undone", async () => {
  const d = db();
  const first = await recordFtpChoice("confirmed", opts(d));
  const second = await recordFtpChoice("fixed", opts(d));
  assert.ok(first.ok && second.ok);
  assert.deepEqual(await undoFtpChoice(first.id, opts(d)), { ok: false, reason: "stale" });
  assert.equal(d.acks.length, 2);
  assert.deepEqual(await undoFtpChoice(second.id, opts(d)), { ok: true });
  assert.deepEqual(d.acks.map((a) => a.choice), ["confirmed"]);
  assert.deepEqual(await undoFtpChoice(second.id, opts(d)), { ok: true }); // already gone
  assert.deepEqual(await undoFtpChoice("2", opts(d)), { ok: false, reason: "invalid" });
});

test("failure injection: cut or lose any request of a choice, retry once, and exactly one answer stands", async () => {
  for (const mode of ["cutAt", "loseReplyAt"] as const) {
    for (let at = 1; at <= 4; at += 1) {
      const d = db({ [mode]: at });
      const first = await recordFtpChoice("confirmed", opts(d));
      d.cutAt = undefined;
      d.loseReplyAt = undefined;
      const retry = await recordFtpChoice("confirmed", opts(d));
      assert.ok(retry.ok, `${mode} ${at}`);
      assert.equal(d.acks.length, 1, `${mode} ${at}: one answer, never two`);
      if (first.ok) assert.equal(first.id, retry.id);
    }
  }
});

test("failure injection: cut or lose any request of Fortryd, retry once, and the answer is gone", async () => {
  for (const mode of ["cutAt", "loseReplyAt"] as const) {
    for (let at = 1; at <= 2; at += 1) {
      const d = db();
      const chosen = await recordFtpChoice("confirmed", opts(d));
      assert.ok(chosen.ok && chosen.id !== null);
      d.requests = 0;
      d[mode] = at;
      await undoFtpChoice(chosen.id, opts(d));
      d.cutAt = undefined;
      d.loseReplyAt = undefined;
      assert.deepEqual(await undoFtpChoice(chosen.id, opts(d)), { ok: true }, `${mode} ${at}`);
      assert.equal(d.acks.length, 0, `${mode} ${at}`);
    }
  }
});

test("contract: the web's insert is the row Python reads (fixtures/ftp-ack.json)", () => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/ftp-ack.json", import.meta.url), "utf-8")) as { insert: unknown };
  const status = { ftpW: 230, eftpW: 183, credible: true, lastTestedOn: null, ftpSince: null, suppressedUntil: null };
  assert.deepEqual(ackInsert("confirmed", status), f.insert);
  assert.equal(ackInsert("confirmed", { ...status, ftpW: null }), null);
});
