import assert from "node:assert/strict";
import { test } from "node:test";

import { type WakeLockApi, type WakeLockHandle, wakeLockController } from "../src/lib/wake-lock.ts";

function fakeApi(): { api: WakeLockApi; requests: number; handles: (WakeLockHandle & { releases: number })[] } {
  const state = {
    requests: 0,
    handles: [] as (WakeLockHandle & { releases: number })[],
    api: {
      request: async () => {
        state.requests += 1;
        const h = {
          released: false,
          releases: 0,
          release: async () => {
            h.released = true;
            h.releases += 1;
          },
        };
        state.handles.push(h);
        return h;
      },
    } as WakeLockApi,
  };
  return state;
}

test("wake lock: acquires once, re-acquires when visible again, releases on finish", async () => {
  const fake = fakeApi();
  let visible = true;
  const lock = wakeLockController(fake.api, () => visible);
  await lock.hold();
  await lock.hold(); // a re-render or a second hold: still one lock
  assert.equal(fake.requests, 1);
  visible = false;
  await lock.visibility(); // hidden: the browser drops it
  assert.equal(fake.handles[0].released, true);
  visible = true;
  await lock.visibility();
  assert.equal(fake.requests, 2);
  lock.release(); // finished view / Afslut / unmount
  assert.equal(fake.handles[1].releases, 1);
  await lock.visibility();
  assert.equal(fake.requests, 2); // not wanted any more: nothing re-requested
});

test("wake lock: unsupported or refused is silent", async () => {
  const none = wakeLockController(undefined, () => true);
  await none.hold();
  none.release();
  const refusing: WakeLockApi = { request: () => Promise.reject(new Error("NotAllowedError")) };
  const lock = wakeLockController(refusing, () => true);
  await assert.doesNotReject(lock.hold());
  lock.release();
});
