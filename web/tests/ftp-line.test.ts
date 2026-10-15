import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseFtpAckRow, parseFtpStatusRow, RowError, type AppNoticeRow, type FtpStatusRow } from "../src/lib/db/rows.ts";
import {
  choiceLabel,
  choiceResult,
  ftpDate,
  ftpLine,
  parseAckId,
  parseFtpChoice,
  shownNotice,
} from "../src/lib/ftp-line.ts";

const TODAY = "2026-10-15";
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8"));
const STATUS = fixture("ftp-status.json") as Record<"quiet" | "suppressed" | "none", unknown>;

const NOTICE: AppNoticeRow = {
  kind: "ftp_mismatch",
  date: TODAY,
  message: "FTP er sat til 230 W, men dine ture peger på 183 W",
  updatedAt: "2026-10-15T03:00:00+00:00",
};
const CREDIBLE: FtpStatusRow = { ftpW: 230, eftpW: 183, credible: true, lastTestedOn: "2026-10-04", ftpSince: "2026-03-21", suppressedUntil: null };

test("contract: Python's ftp_status rows parse and give ftp-confirm.md §1's lines (fixtures/ftp-status.json)", () => {
  assert.deepEqual(ftpLine(parseFtpStatusRow(STATUS.quiet), null, null, TODAY), { kind: "quiet", text: "FTP 230 W · ikke testet siden 17. maj" });
  assert.deepEqual(ftpLine(parseFtpStatusRow(STATUS.suppressed), null, null, TODAY), {
    kind: "quiet",
    text: "FTP 230 W · bekræftet · tjekkes igen 13. dec.",
  });
  assert.deepEqual(ftpLine(parseFtpStatusRow(STATUS.none), NOTICE, null, TODAY), { kind: "none" });
  assert.deepEqual(parseFtpStatusRow(STATUS.quiet).ftpSince, "2026-03-21");
});

test("the warning: Python's notice with its next step; an answer after the run hides it until the next run", () => {
  const warning = ftpLine(CREDIBLE, NOTICE, null, TODAY);
  assert.deepEqual(warning, {
    kind: "warning",
    text: "FTP er sat til 230 W, men dine ture peger på 183 W. Cykel-TSS regnes ud fra FTP, så ret den i intervals.icu.",
    ftpW: 230,
  });
  const after = { id: 4, choice: "fixed" as const, at: "2026-10-15T07:00:00+00:00" };
  const before = { ...after, at: "2026-10-15T02:00:00+00:00" };
  assert.equal(shownNotice(NOTICE, after), null);
  assert.equal(shownNotice(NOTICE, before), NOTICE); // the run after the answer wrote it again
  assert.deepEqual(ftpLine(CREDIBLE, NOTICE, after, TODAY), { kind: "none" }); // credible, answered
});

test("quiet lines: never tested in 52 weeks, a date in another year, nothing when credible and agreed", () => {
  const never = { ...CREDIBLE, credible: false, lastTestedOn: null };
  assert.deepEqual(ftpLine(never, null, null, TODAY), { kind: "quiet", text: "FTP 230 W · ikke testet de sidste 52 uger" });
  assert.equal(ftpDate("2025-09-07", TODAY), "7. sep. 2025");
  assert.equal(ftpDate("2026-05-17", TODAY), "17. maj");
  assert.deepEqual(ftpLine(CREDIBLE, null, null, TODAY), { kind: "none" });
  assert.deepEqual(ftpLine(null, NOTICE, null, TODAY), { kind: "none" }); // never a guessed FTP
});

test("ftp-confirm.md §2–§3: labels and results; the client's input is checked", () => {
  assert.equal(choiceLabel("confirmed", 230), "230 W er rigtigt");
  assert.equal(choiceLabel("fixed", 230), "Jeg har rettet FTP");
  assert.match(choiceResult("confirmed"), /^Skjult i 60 dage/);
  assert.match(choiceResult("fixed"), /næste kørsel/);
  assert.equal(parseFtpChoice("confirmed"), "confirmed");
  for (const odd of ["Confirmed", "", null, 1, { choice: "fixed" }]) assert.equal(parseFtpChoice(odd), null);
  assert.equal(parseAckId(7), 7);
  for (const odd of [0, -1, 1.5, "7", null, Number.MAX_SAFE_INTEGER + 1]) assert.equal(parseAckId(odd), null);
});

test("ftp rows refuse what the table never holds", () => {
  assert.throws(() => parseFtpStatusRow({ ...(STATUS.quiet as object), ftp_w: 0 }), RowError);
  assert.throws(() => parseFtpAckRow({ id: 1, choice: "maybe", at: "2026-10-15T08:00:00+00:00" }), RowError);
});
