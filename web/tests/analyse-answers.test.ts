import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { answerBlock, buildAnswers, MISSING_TEXT } from "../src/lib/analyse-answers.ts";
import { EF_TREND_MIN_RIDES } from "../src/lib/analyse-view.ts";
import { ILLUSTRATIVE_ANSWERS, illustrativeAnswers } from "../src/lib/db/dev-fixture.ts";
import { PostgrestError } from "../src/lib/db/postgrest.ts";
import { type AnalysisSummaryRow, parseAnalysisSummaryRow, RowError } from "../src/lib/db/rows.ts";

// Python's real output (python/tests/test_contract_*.py writes it): `live` = today's rows, `edges` = more states.
const fixture: { live: unknown[]; edges: Record<string, unknown> } = JSON.parse(
  readFileSync(new URL("./fixtures/analysis_summary.json", import.meta.url), "utf8"),
);
const live = fixture.live.map(parseAnalysisSummaryRow);
const edges = Object.fromEntries(Object.entries(fixture.edges).map(([k, v]) => [k, parseAnalysisSummaryRow(v)]));
const edge = (k: string): AnalysisSummaryRow => {
  const row = edges[k];
  assert.ok(row !== undefined, k);
  return row;
};
const block = (row: AnalysisSummaryRow) => {
  const b = answerBlock(row.question, row, 2026);
  assert.equal(b.kind, "answer");
  if (b.kind !== "answer") throw new Error("unreachable");
  return b;
};

test("contract: every fixture row parses, and the text and direction pass through unchanged", () => {
  for (const row of [...live, ...Object.values(edges)]) {
    const b = block(row);
    assert.equal(b.verdict, row.verdictText);
    assert.equal(b.detail, row.detailText);
    assert.equal(b.figure.arrow, row.state === "answer" ? row.direction : null);
    assert.equal(row.state === "needs_data", row.direction === null);
  }
});

test("the web's EF trend-line rule is Python's EF_MIN_RIDES (the fixture's ef need_n)", () => {
  const ef = live.find((r) => r.question === "ef");
  assert.equal(ef?.needN, EF_TREND_MIN_RIDES);
});

test("live today: 183 W flat, 0 af 3 without an arrow, 0,9 t with the no-plan detail", () => {
  const view = buildAnswers(live, null, 2026);
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  const [eftp, ef, volume] = view.blocks.map((b) => {
    assert.equal(b.kind, "answer");
    if (b.kind !== "answer") throw new Error("unreachable");
    return b;
  });
  assert.ok(eftp !== undefined && ef !== undefined && volume !== undefined);
  assert.deepEqual(eftp.figure, {
    arrow: "flat",
    number: "183 W",
    sr: "uændret 183 W",
    caption: "eFTP nu · for 6 uger siden 188 W",
    large: true,
  });
  assert.equal(eftp.title, "Er jeg stærkere?");
  assert.deepEqual(ef.figure, {
    arrow: null,
    number: "0 af 3",
    sr: "0 af 3",
    caption: "rolige ture med puls og watt de sidste 28 dage",
    large: false,
  });
  assert.equal(volume.figure.number, "0,9 t");
  assert.equal(volume.figure.caption, "pr. uge, snit af de sidste 4 hele uger · mål 3,0 t");
  assert.equal(volume.detail, "Ingen planlagte ture de sidste 4 uger.");
  assert.match(volume.disclosure[0] ?? "", /Målet på 3,0 t pr\. uge er sat 13\. okt\./);
  for (const b of [eftp, ef, volume]) assert.ok(!b.figure.number.includes("0 af 0"));
});

test("numbers are formatted only: EF 2 dp, hours 1 dp, a real zero stays 0,0 t", () => {
  assert.equal(block(edge("ef_up")).figure.number, "1,20");
  assert.equal(block(edge("ef_up")).figure.caption, "EF på rolige ture · for 6 uger siden 1,10");
  assert.equal(block(edge("ef_up")).figure.sr, "stigende 1,20");
  assert.equal(block(edge("volume_zero")).figure.number, "0,0 t");
  assert.equal(block(edge("volume_plan")).figure.number, "3,1 t");
});

test("eFTP needs_data: the number kept with caption eFTP nu; none at all is – (ikke registreret)", () => {
  const stale = block(edge("eftp_stale"));
  assert.equal(stale.figure.number, "186 W");
  assert.equal(stale.figure.caption, "eFTP nu");
  assert.equal(stale.figure.arrow, null);
  const none = block(edge("eftp_none"));
  assert.equal(none.figure.number, "–");
  assert.equal(none.figure.sr, "ikke registreret");
});

test("EF needs_data with a value: the number kept with caption EF på rolige ture nu, no arrow", () => {
  const now = block(edge("ef_now_only"));
  assert.equal(now.figure.number, "1,20");
  assert.equal(now.figure.caption, "EF på rolige ture nu");
  assert.equal(now.figure.arrow, null);
  assert.equal(now.figure.sr, "1,20");
});

test("a missing row says so; a failed read is an error in place of the blocks", () => {
  const view = buildAnswers(live.filter((r) => r.question !== "volume"), null, 2026);
  assert.ok(view.kind === "ready");
  const missing = view.blocks[2];
  assert.equal(missing?.kind, "missing");
  if (missing?.kind === "missing") {
    assert.equal(missing.title, "Træner jeg nok?");
    assert.equal(missing.text, MISSING_TEXT);
  }
  const error = new PostgrestError("analysis_summary", 500, "boom");
  assert.deepEqual(buildAnswers(null, error, 2026), { kind: "error", error });
});

test("the parser refuses a row that breaks the contract instead of guessing", () => {
  const raw = (patch: Record<string, unknown>) => ({ ...(fixture.live[0] as object), ...patch });
  assert.throws(() => parseAnalysisSummaryRow(raw({ question: "ftp" })), RowError);
  assert.throws(() => parseAnalysisSummaryRow(raw({ direction: null })), RowError);
  assert.throws(() => parseAnalysisSummaryRow(raw({ value: "183" })), RowError);
  assert.throws(() => parseAnalysisSummaryRow(raw({ verdict_text: " " })), RowError);
  assert.throws(() => parseAnalysisSummaryRow({ ...(fixture.live[1] as object), need_n: null }), RowError);
  assert.throws(() => parseAnalysisSummaryRow(raw({ delta: null })), RowError); // an answer needs its delta
  assert.throws(() => parseAnalysisSummaryRow(raw({ value: 183.5 })), RowError); // eFTP is whole W
  const volume = (patch: Record<string, unknown>) => ({ ...(fixture.edges.volume_plan as object), ...patch });
  assert.throws(() => parseAnalysisSummaryRow(volume({ state: "needs_data", direction: null })), RowError);
  assert.throws(() => parseAnalysisSummaryRow(volume({ done_n: null })), RowError); // planned without done
  assert.throws(() => parseAnalysisSummaryRow(volume({ done_n: 5 })), RowError); // more done than planned
  assert.throws(() => parseAnalysisSummaryRow(volume({ planned_n: null })), RowError); // done without planned
});

test("DEV_FIXTURE=answers: the contract fixture's rows, all three answered, real computed_at kept", () => {
  assert.deepEqual(ILLUSTRATIVE_ANSWERS, [live[0], edge("ef_up"), edge("volume_plan")]);
  assert.ok(ILLUSTRATIVE_ANSWERS.every((a) => a.state === "answer"));
  const real = live.map((r) => ({ ...r, computedAt: "2026-10-13T10:00:00+00:00" }));
  assert.ok(illustrativeAnswers(real).every((a) => a.computedAt === "2026-10-13T10:00:00+00:00"));
});
