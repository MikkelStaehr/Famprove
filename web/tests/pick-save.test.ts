import assert from "node:assert/strict";
import { test } from "node:test";

import { jumpedFixture } from "../src/lib/db/dev-fixture.ts";
import type { PrescribedSetRow } from "../src/lib/db/rows.ts";
import { createSaveQueue, halts, type SaveOutcome } from "../src/lib/jump-save.ts";
import { pickAfter, pickedShape, pickOutcome } from "../src/lib/pick-save.ts";
import { lastTap, type LoggedSet, setKey, undoesOf } from "../src/lib/set-taps.ts";
import { pickRunRows, sessionRuns } from "../src/lib/supersets.ts";

test("superset-any rule 11–12: a failed or refused pick puts the stored order back at once; a saved one keeps the pick's", () => {
  assert.equal(pickOutcome(null), "failed");
  assert.equal(pickOutcome({ ok: false, reason: "failed" }), "failed");
  assert.equal(pickOutcome({ ok: false, reason: "started" }), "refused");
  assert.equal(pickOutcome({ ok: false, reason: "dev" }), "dev");
  assert.equal(pickOutcome({ ok: true, pairs: [], runRows: [1, 3, 2] }), "saved");
  assert.deepEqual(pickAfter("failed", null, [1, 3, 2]), { runRows: null, line: "failed" });
  assert.deepEqual(pickAfter("refused", [2, 1, 3], [1, 3, 2]), { runRows: [2, 1, 3], line: "refused" });
  assert.deepEqual(pickAfter("saved", null, [1, 3, 2]), { runRows: [1, 3, 2], line: null });
  assert.deepEqual(pickAfter("dev", null, [1, 3, 2]), { runRows: [1, 3, 2], line: null });
});

test("superset-any rule 11: a failed pick halts the queue; Gem igen sends the pick, then the held taps, in order", async () => {
  assert.equal(halts({ kind: "pick" }), true);
  const sent: string[] = [];
  let pickFails = true;
  const queue = createSaveQueue<{ kind: string; id: string }>(() => {});
  const send = (id: string, outcome: () => SaveOutcome) => async () => {
    sent.push(id);
    return outcome();
  };
  queue.push({ kind: "pick", id: "pick" }, send("pick", () => (pickFails ? "failed" : "saved")));
  queue.push({ kind: "done", id: "done" }, send("done", () => "saved"));
  queue.push({ kind: "jump", id: "jump" }, send("jump", () => "saved"));
  await queue.flush();
  assert.deepEqual(sent, ["pick"]); // the later taps wait, unsent
  assert.deepEqual(queue.state().failed.map((f) => f.id), ["pick", "done", "jump"]);
  assert.equal(queue.state().halted, true);
  pickFails = false;
  queue.retry();
  await queue.flush();
  assert.deepEqual(sent, ["pick", "pick", "done", "jump"]);
  assert.deepEqual(queue.state().failed, []);
});

function sheetRows(): PrescribedSetRow[] {
  const runs: [number, string, number][] = [[30, "Squat", 2], [31, "Bench", 3], [32, "Row", 2], [33, "Curl", 2]];
  return runs.flatMap(([sheetRow, name, n]) =>
    Array.from({ length: n }, (_, k) => ({
      weekStart: "2026-10-12", session: 1, block: "B", week: 3, sheetRow, setNo: k + 1, name, type: "X", setsText: String(n),
      repsText: "5", prescribed: null, loggedKg: null, bodyweight: false, variantId: null, variant: null,
    })),
  );
}

test("superset-any: jump, then pick, then Fortryd undoes the done before the jump, not the pick (client = server)", () => {
  const { setLog, sessionOrders } = jumpedFixture(sheetRows(), "2026-10-12", new Date("2026-10-12T10:00:00.000Z"));
  const log = new Map<string, LoggedSet>(setLog.map((r) => [setKey(r), r]));
  const sets = sheetRows().map((r) => ({ ref: { row: r.sheetRow, set: r.setNo }, name: r.name }));
  const jumpedShape = { sets, pairs: [], runRows: sessionOrders[0].runRows, jump: sessionOrders[0].jump };
  const jump = lastTap(log, jumpedShape);
  assert.equal(jump?.kind, "jump");
  assert.equal(undoesOf(log, jump!.ref, jumpedShape), "jump");
  // The pick: Curl (33) right after Row (32), the jumped-to run; the server writes this order with no jump mark.
  const runs = sessionRuns(sets, new Map([["squat", 1], ["bench", 2], ["row", 3], ["curl", 4]]));
  const order = pickRunRows(runs, jumpedShape.runRows, 32, 33);
  assert.deepEqual(order, [30, 32, 33, 31]);
  const after = pickedShape(jumpedShape, order);
  assert.equal(after.jump, null); // as the server's upsert (previous_rows, jumped_at, moved_start = null)
  assert.notEqual(lastTap(log, after)?.kind, "jump");
  assert.notEqual(undoesOf(log, jump!.ref, after), "jump"); // Fortryd now undoes a set, never the pick's order
});
