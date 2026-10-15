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

/** A request that resolves only when the test says so; the browser may release a lock it granted while hidden. */
function deferredApi(): {
  api: WakeLockApi;
  requests: number;
  resolveNext: () => { released: boolean; releases: number; release(): Promise<void> };
} {
  const pending: ((h: WakeLockHandle) => void)[] = [];
  const state = {
    requests: 0,
    api: {
      request: () =>
        new Promise<WakeLockHandle>((resolve) => {
          state.requests += 1;
          pending.push(resolve);
        }),
    } as WakeLockApi,
    resolveNext: () => {
      const h = {
        released: false,
        releases: 0,
        release: async () => {
          h.released = true;
          h.releases += 1;
        },
      };
      const resolve = pending.shift();
      assert.ok(resolve, "a pending request");
      resolve(h);
      return h;
    },
  };
  return state;
}

test("wake lock: hidden and shown while a request is pending asks once more after it settles", async () => {
  const fake = deferredApi();
  let visible = true;
  const lock = wakeLockController(fake.api, () => visible);
  const first = lock.hold();
  visible = false;
  await lock.visibility();
  visible = true;
  const shown = lock.visibility(); // pending: remembered, not a second parallel request
  assert.equal(fake.requests, 1);
  const h1 = fake.resolveNext();
  h1.released = true; // the browser dropped the lock it granted around the hide
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fake.requests, 2); // asked again
  const h2 = fake.resolveNext();
  await Promise.all([first, shown]);
  assert.equal(h2.released, false);
  lock.release();
  assert.equal(h2.releases, 1);
});

test("wake lock: unmount while a request is pending releases the lock when it arrives", async () => {
  const fake = deferredApi();
  const lock = wakeLockController(fake.api, () => true);
  const held = lock.hold();
  lock.release(); // Afslut / unmount before the browser answered
  const h = fake.resolveNext();
  await held;
  assert.equal(h.releases, 1);
  assert.equal(fake.requests, 1);
});
