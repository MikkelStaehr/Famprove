import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSaveQueue,
  failedBeforeJump,
  haltingJump,
  NO_SAVES,
  onJumpResult,
  type SaveOutcome,
  type SaveState,
} from "../src/lib/jump-save.ts";

type Input = { readonly kind: string; readonly row: number; readonly set: number };

/** A fake action: records every call in order and answers from a script (default "saved"). */
function fake(script: SaveOutcome[]) {
  const calls: string[] = [];
  const action = async (input: Input): Promise<SaveOutcome> => {
    calls.push(`${input.kind} ${input.row}/${input.set}`);
    return script.shift() ?? "saved";
  };
  const reverts: Input[] = [];
  let state: SaveState<Input> = NO_SAVES;
  const queue = createSaveQueue<Input>((s) => (state = s));
  const push = (input: Input) => queue.push(input, () => action(input), () => reverts.push(input));
  return { calls, reverts, queue: { ...queue, push }, state: () => state };
}

const jump1: Input = { kind: "jump", row: 20, set: 1 };
const jump2: Input = { kind: "jump", row: 30, set: 1 };
const done: Input = { kind: "done", row: 30, set: 1 };

test("jump1 fails while jump2 is queued: the line shows, jump2 is held, Gem igen sends jump1 then jump2", async () => {
  const f = fake(["failed"]);
  f.queue.push(jump1);
  f.queue.push(jump2);
  await f.queue.flush();
  assert.deepEqual(f.calls, ["jump 20/1"]);
  assert.equal(haltingJump(f.state()), jump1);
  assert.deepEqual(f.state().failed, [jump1, jump2]);
  assert.equal(f.reverts.length, 0);
  f.queue.retry();
  await f.queue.flush();
  assert.deepEqual(f.calls, ["jump 20/1", "jump 20/1", "jump 30/1"]);
  assert.equal(haltingJump(f.state()), null);
  assert.deepEqual(f.state().failed, []);
});

test("a done after a failed jump is held, then sent after the jump", async () => {
  const f = fake(["failed"]);
  f.queue.push(jump1);
  await f.queue.flush();
  f.queue.push(done);
  await f.queue.flush();
  assert.deepEqual(f.calls, ["jump 20/1"]);
  assert.deepEqual(failedBeforeJump(f.state()), []); // held, not a failed set: the jump's line says it
  assert.equal(f.queue.state().failed.length, 2);
  f.queue.retry();
  await f.queue.flush();
  assert.deepEqual(f.calls, ["jump 20/1", "jump 20/1", "done 30/1"]);
  assert.equal(f.state().halted, false);
});

test("a refused jump: reverts with nothing after it, else the reload state and nothing more is sent", async () => {
  const alone = fake(["refused"]);
  alone.queue.push(jump1);
  await alone.queue.flush();
  assert.deepEqual(alone.reverts, [jump1]);
  assert.equal(alone.state().reload, false);

  const after = fake(["refused"]);
  after.queue.push(jump1);
  after.queue.push(done);
  await after.queue.flush();
  assert.deepEqual(after.calls, ["jump 20/1"]);
  assert.equal(after.reverts.length, 0);
  assert.equal(after.state().reload, true);
  assert.deepEqual(after.state().failed, []);
});

test("a double failure keeps the line and the held taps, in order", async () => {
  const f = fake(["failed", "failed"]);
  f.queue.push(jump1);
  f.queue.push(done);
  await f.queue.flush();
  f.queue.retry();
  await f.queue.flush();
  assert.deepEqual(f.calls, ["jump 20/1", "jump 20/1"]);
  assert.equal(haltingJump(f.state()), jump1);
  assert.deepEqual(f.state().failed, [jump1, done]);
  f.queue.retry();
  await f.queue.flush();
  assert.deepEqual(f.calls, ["jump 20/1", "jump 20/1", "jump 20/1", "done 30/1"]);
  assert.deepEqual(f.state().failed, []);
});

test("a jump's Fortryd held behind its failed jump is sent after it, naming the time the retry stored", async () => {
  let state: SaveState<Input> = NO_SAVES;
  const queue = createSaveQueue<Input>((s) => (state = s));
  const serverAt = new Map<string, string>();
  const calls: string[] = [];
  let jumpTries = 0;
  queue.push(jump1, async () => {
    jumpTries += 1;
    calls.push("jump");
    if (jumpTries === 1) return "failed";
    serverAt.set("local", "T2"); // useSetLog's request records the stored jump's server time
    return "saved";
  });
  const unjump: Input = { kind: "undo", row: 20, set: 1 };
  queue.push(unjump, async () => {
    calls.push(`undo seen=${serverAt.get("local") ?? "local"}`); // the seen is read at send time
    return "saved";
  });
  await queue.flush();
  assert.deepEqual(calls, ["jump"]);
  assert.deepEqual(state.failed, [jump1, unjump]);
  queue.retry();
  await queue.flush();
  assert.deepEqual(calls, ["jump", "jump", "undo seen=T2"]);
  assert.deepEqual(state.failed, []);
});

test("a thrown action is a failure; an undo's drop never removes the halting jump", async () => {
  let state: SaveState<Input> = NO_SAVES;
  const queue = createSaveQueue<Input>((s) => (state = s));
  queue.push(
    jump1,
    async () => {
      throw new Error("offline");
    },
    () => assert.fail("no revert on a failure"),
  );
  await queue.flush();
  queue.drop((f) => !(f.row === 20 && f.set === 1));
  assert.deepEqual(state.failed, [jump1]);
});

test("onJumpResult is the pure decision", () => {
  assert.deepEqual(onJumpResult(NO_SAVES, jump1, "failed", true), { ...NO_SAVES, failed: [jump1], halted: true });
  assert.equal(onJumpResult(NO_SAVES, jump1, "saved", true), NO_SAVES);
  assert.deepEqual(onJumpResult(NO_SAVES, jump1, "refused", false), NO_SAVES);
  assert.deepEqual(onJumpResult(NO_SAVES, jump1, "refused", true), { ...NO_SAVES, reload: true, stopped: true });
  assert.deepEqual(onJumpResult(NO_SAVES, jump1, "dev", false), { ...NO_SAVES, dev: true });
});

test("a jump after an ordinary tap that failed is held behind it; Gem igen sends the tap, then the jump", async () => {
  const before: Input = { kind: "done", row: 20, set: 1 };
  const f = fake(["failed"]);
  f.queue.push(before);
  await f.queue.flush();
  f.queue.push(jump2);
  await f.queue.flush();
  assert.deepEqual(f.calls, ["done 20/1"]); // the jump never went out ahead of the failed done
  assert.equal(f.state().halted, true);
  assert.deepEqual(f.state().failed, [before, jump2]);
  assert.deepEqual(failedBeforeJump(f.state()), [before]);
  assert.equal(haltingJump(f.state()), jump2);
  f.queue.retry();
  await f.queue.flush();
  assert.deepEqual(f.calls, ["done 20/1", "done 20/1", "jump 30/1"]);
  assert.deepEqual(f.state().failed, []);
  assert.equal(f.state().halted, false);
});
