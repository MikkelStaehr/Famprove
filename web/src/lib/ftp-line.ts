/**
 * The FTP line on /load (user, 2026-10-15, slice ftp-confirm; spec design/specs/ftp-confirm.md).
 * Pure: it picks a state from Python's ftp_status and notice and the user's newest answer, and
 * holds every text. It calculates nothing: credibility, "ikke testet siden", the 60 days and the
 * 5 % are Python's (domain/ftp_check.py); the one comparison here is "an answer newer than the
 * notice hides it until the next run writes the notice again".
 */
import { formatDate } from "./format.ts";
import { noticeText } from "./notices.ts";
import type { AppNoticeRow, FtpAckChoice, FtpAckRow, FtpStatusRow, IsoDate } from "./db/rows.ts";

export const FTP_NOTICE_KIND = "ftp_mismatch";

export type FtpLine =
  | { readonly kind: "warning"; readonly text: string; readonly ftpW: number }
  | { readonly kind: "quiet"; readonly text: string }
  | { readonly kind: "none" };

/** "17. maj", with the year only when it isn't `today`'s ("17. maj 2025"). */
export function ftpDate(date: IsoDate, today: IsoDate): string {
  return date.slice(0, 4) === today.slice(0, 4) ? formatDate(date) : `${formatDate(date)} ${date.slice(0, 4)}`;
}

/** The notice, unless the newest answer came after the run that wrote it. */
export function shownNotice(notice: AppNoticeRow | null, latestAck: FtpAckRow | null): AppNoticeRow | null {
  if (notice === null) return null;
  return latestAck !== null && Date.parse(latestAck.at) > Date.parse(notice.updatedAt) ? null : notice;
}

/** ftp-confirm.md §1: warning | quiet (not tested, or confirmed) | none. */
export function ftpLine(
  status: FtpStatusRow | null,
  notice: AppNoticeRow | null,
  latestAck: FtpAckRow | null,
  today: IsoDate,
): FtpLine {
  if (status === null || status.ftpW === null) return { kind: "none" };
  const ftp = `FTP ${status.ftpW} W`;
  const shown = shownNotice(notice, latestAck);
  if (shown !== null) return { kind: "warning", text: noticeText(shown.kind, shown.message), ftpW: status.ftpW };
  if (status.credible === false) {
    const since = status.lastTestedOn === null ? "ikke testet de sidste 52 uger" : `ikke testet siden ${ftpDate(status.lastTestedOn, today)}`;
    return { kind: "quiet", text: `${ftp} · ${since}` };
  }
  if (status.suppressedUntil !== null) {
    return { kind: "quiet", text: `${ftp} · bekræftet · tjekkes igen ${ftpDate(status.suppressedUntil, today)}` };
  }
  return { kind: "none" };
}

/** §2–§3: the panel's labels, the result after a choice, and the failure lines. */
export function choiceLabel(choice: FtpAckChoice, ftpW: number): string {
  return choice === "confirmed" ? `${ftpW} W er rigtigt` : "Jeg har rettet FTP";
}

export function choiceResult(choice: FtpAckChoice): string {
  return choice === "confirmed"
    ? "Skjult i 60 dage, eller til FTP ændres, eller et hårdt tag flytter eFTP mere end 5 %."
    : "Tjekkes igen ved næste kørsel – eller tryk ↻ øverst for at hente nu.";
}

export const WARNING_SR_SUFFIX = ", vælg svar";
export const SAVE_FAILED = "Valget blev ikke gemt, fordi serveren ikke svarede. Advarslen står; prøv igen.";
export const UNDO_FAILED = "Fortryd blev ikke gemt. Valget står.";
export const UNDO_LABEL = "Fortryd";

/** The server action's answers (lib/db/ftp-ack.ts); `id` null = nothing written (dev switch). */
export type FtpChoiceResult =
  | { readonly ok: true; readonly id: number | null }
  | { readonly ok: false; readonly reason: "invalid" | "no_notice" | "failed" };
export type FtpUndoResult = { readonly ok: true } | { readonly ok: false; readonly reason: "invalid" | "stale" | "failed" };

export function parseFtpChoice(raw: unknown): FtpAckChoice | null {
  return raw === "confirmed" || raw === "fixed" ? raw : null;
}

/** An ftp_ack id as the client sends it back for Fortryd: a positive safe integer, else null. */
export function parseAckId(raw: unknown): number | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}
