import "server-only";

import {
  type FtpChoiceResult,
  FTP_NOTICE_KIND,
  type FtpUndoResult,
  parseAckId,
  parseFtpChoice,
} from "../ftp-line.ts";
import { devFixture } from "./dev-fixture.ts";
import { readSupabaseEnv } from "./env.ts";
import { createClient, insertReturning, type PostgrestClient, selectFirst, write } from "./postgrest.ts";
import {
  APP_NOTICES_SELECT,
  FTP_ACK_SELECT,
  FTP_STATUS_SELECT,
  type FtpAckChoice,
  type FtpStatusRow,
  parseAppNoticeRow,
  parseFtpAckRow,
  parseFtpStatusRow,
} from "./rows.ts";

/**
 * The app's second write path (user, 2026-10-15, slice ftp-confirm): the user's answer to the FTP
 * notice on /load, into public.ftp_ack. Server-side only with the service key, behind Vercel
 * Authentication, via the server actions in app/actions.ts. At most one write per tap, and a retry
 * after a lost reply finishes the tap instead of repeating it (CLAUDE.md "Multi-request writes"):
 *  - choose: one INSERT of { choice, ftp_w, eftp_w } (the W values read here from ftp_status,
 *    never from the client; `at` is the column default, the server's clock). Refused unless an
 *    ftp_mismatch notice exists now. When the newest answer already answers this notice (newer
 *    than its updated_at) with the same choice, that one is returned and nothing is written.
 *  - undo (Fortryd): one DELETE of that id, only while it is still the newest answer; an id that
 *    is already gone (the newest id is lower) counts as undone.
 * Dev switches (DEV_TODAY, DEV_FIXTURE) write nothing and answer ok (id null), so the result line
 * can be screenshotted. Python reads the newest row (collect-plan, domain/ftp_check.py).
 */

const ACK = FTP_ACK_SELECT.table;

function client(): PostgrestClient {
  const env = readSupabaseEnv();
  return createClient(env.url, env.serviceKey, (url, init) => fetch(url, init));
}

/** Under `next dev` with DEV_TODAY or DEV_FIXTURE the screen is not today's: write nothing. */
function devSwitchOn(env: Readonly<Record<string, string | undefined>>, nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" && (Boolean(env.DEV_TODAY) || devFixture(env, nodeEnv) !== null);
}

/** Injectable for tests; production reads process.env and uses globalThis.fetch. */
export type FtpAckOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeEnv?: string;
  readonly client?: () => PostgrestClient;
};

/** The row the web inserts (the contract with python db/ftp.py: web/tests/fixtures/ftp-ack.json). */
export function ackInsert(
  choice: FtpAckChoice,
  status: FtpStatusRow,
): { readonly choice: FtpAckChoice; readonly ftp_w: number; readonly eftp_w: number | null } | null {
  return status.ftpW === null ? null : { choice, ftp_w: status.ftpW, eftp_w: status.eftpW };
}

export async function recordFtpChoice(raw: unknown, options: FtpAckOptions = {}): Promise<FtpChoiceResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  const choice = parseFtpChoice(raw);
  if (choice === null) return { ok: false, reason: "invalid" };
  if (devSwitchOn(env, nodeEnv)) return { ok: true, id: null };
  try {
    const c = makeClient();
    const [status, notice, latest] = await Promise.all([
      selectFirst(c, FTP_STATUS_SELECT.table, FTP_STATUS_SELECT, parseFtpStatusRow),
      selectFirst(c, APP_NOTICES_SELECT.table, { ...APP_NOTICES_SELECT, filters: [["kind", `eq.${FTP_NOTICE_KIND}`]] }, parseAppNoticeRow),
      selectFirst(c, ACK, FTP_ACK_SELECT, parseFtpAckRow),
    ]);
    const body = status === null || notice === null ? null : ackInsert(choice, status);
    if (body === null || notice === null) return { ok: false, reason: "no_notice" };
    if (latest !== null && latest.choice === choice && Date.parse(latest.at) > Date.parse(notice.updatedAt)) {
      return { ok: true, id: latest.id }; // a retry of a tap whose insert landed: done already
    }
    const row = await insertReturning(c, ACK, body, parseFtpAckRow);
    return { ok: true, id: row.id };
  } catch (error) {
    console.error("ftp-ack: choose failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: "failed" };
  }
}

export async function undoFtpChoice(raw: unknown, options: FtpAckOptions = {}): Promise<FtpUndoResult> {
  const { env = process.env, nodeEnv = process.env.NODE_ENV, client: makeClient = client } = options;
  const id = parseAckId(raw);
  if (id === null) return { ok: false, reason: "invalid" };
  if (devSwitchOn(env, nodeEnv)) return { ok: true };
  try {
    const c = makeClient();
    const latest = await selectFirst(c, ACK, FTP_ACK_SELECT, parseFtpAckRow);
    if (latest === null || latest.id < id) return { ok: true }; // gone already: a retried undo
    if (latest.id > id) return { ok: false, reason: "stale" }; // a newer answer stands
    await write(c, ACK, "DELETE", { params: [["id", `eq.${id}`]] });
    return { ok: true };
  } catch (error) {
    console.error("ftp-ack: undo failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: "failed" };
  }
}
