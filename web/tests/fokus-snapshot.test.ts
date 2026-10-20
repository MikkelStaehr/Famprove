import assert from "node:assert/strict";
import { test } from "node:test";

import {
  barCaption,
  type FokusSnapshot,
  markSignalled,
  MINIMISE_REFUSED,
  minimiseAction,
  nextLine,
  readSnapshot,
  sharedVibrator,
  SNAPSHOT_KEY,
  type SnapshotStore,
  snapshotOf,
  writeSnapshot,
} from "../src/lib/fokus-snapshot.ts";
import { type FokusExercise, fokusView } from "../src/lib/fokus-view.ts";
import { restSignal } from "../src/lib/rest-signal.ts";
import { applyTap, type LoggedSet, type SetRef } from "../src/lib/set-taps.ts";
import { wakeLockController, type WakeLockHandle } from "../src/lib/wake-lock.ts";

const DAY = "2026-10-19";

const SQUAT: FokusExercise = {
  name: "Squat ",
  variant: null,
  variantId: null,
  repsText: "5",
  prescribed: "RPE 7",
  bodyweight: false,
  reference: { kg: 140, bodyweight: false },
  row: 4,
  suggestedKg: 142.5,
  suggestionBasis: "rpe_e1rm",
  suggestionCapped: false,
  adjustmentKg: null,
  adjustmentReason: null,
  restMinS: 180,
  restMaxS: 300,
  ramp: null,
  todayKg: 142.5,
  todayBasis: "e1rm",
  sets: [
    { row: 4, set: 1 },
    { row: 4, set: 2 },
    { row: 4, set: 3 },
  ],
};
const ORDER: readonly SetRef[] = SQUAT.sets;

function memory(): SnapshotStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: SnapshotStore = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

/** Real taps through the shared transition: begin, then a done per ref. */
function played(taps: readonly ["begin" | "done" | "skip" | "undo", SetRef, string][]): ReadonlyMap<string, LoggedSet> {
  let log: ReadonlyMap<string, LoggedSet> = new Map();
  for (const [kind, ref, at] of taps) log = applyTap(ORDER, log, kind, ref, at);
  return log;
}

function viewOf(log: ReadonlyMap<string, LoggedSet>) {
  return fokusView({ exercises: [SQUAT], pairs: [], order: ORDER, week: 2, session: 1 }, log);
}

test("snapshot after a done: next set, kg, rest start and window (criterion 4)", () => {
  const log = played([
    ["begin", ORDER[0], "2026-10-19T10:00:00Z"],
    ["done", ORDER[0], "2026-10-19T10:01:00Z"],
  ]);
  const snap = snapshotOf(DAY, 1, viewOf(log), log.size > 0);
  assert.deepEqual(snap, {
    date: DAY,
    session: 1,
    next: { name: "Squat", n: 2, reps: "5", kg: "~142,5" }, // the e1RM estimate keeps Fokus's "~"
    restSince: "2026-10-19T10:01:00Z",
    restMinS: 180,
    restMaxS: 300,
    signalled: null,
  });
});

test("every tap rewrites it: skip, undo; none before begin and none when every set is done or skipped (criterion 12)", () => {
  const begun = played([["begin", ORDER[0], "2026-10-19T10:00:00Z"]]);
  assert.equal(snapshotOf(DAY, 1, viewOf(new Map()), false), null);
  assert.equal(snapshotOf(DAY, 1, viewOf(begun), true)?.restSince, null); // set 1 not done: no rest timer
  const skipped = applyTap(ORDER, begun, "skip", ORDER[0], "2026-10-19T10:02:00Z");
  assert.equal(snapshotOf(DAY, 1, viewOf(skipped), true)?.next.n, 2);
  const undone = applyTap(ORDER, skipped, "undo", ORDER[0], "2026-10-19T10:03:00Z");
  assert.equal(snapshotOf(DAY, 1, viewOf(undone), true)?.next.n, 1);
  let all = begun;
  for (const r of ORDER) all = applyTap(ORDER, all, "done", r, "2026-10-19T10:05:00Z");
  assert.equal(snapshotOf(DAY, 1, viewOf(all), true), null);
});

test("missing kg: '<reps> reps', never 0 kg", () => {
  const bw = { ...SQUAT, todayKg: null, todayBasis: null, suggestedKg: null, reference: null } as unknown as FokusExercise; // a set without any kg
  const log = played([["begin", ORDER[0], "2026-10-19T10:00:00Z"]]);
  const snap = snapshotOf(DAY, 1, fokusView({ exercises: [bw], pairs: [], order: ORDER, week: 2, session: 1 }, log), true);
  assert.equal(snap?.next.kg, null);
  assert.equal(nextLine(snap!.next).rest, " · sæt 1 · 5 reps");
  assert.equal(nextLine({ name: "Squat", n: 2, reps: "5", kg: "140" }).rest, " · sæt 2 · 5 × 140 kg");
});

test("write, read; another day is cleared; unreadable is discarded; a failing store is no bar", () => {
  const store = memory();
  const snap: FokusSnapshot = { date: DAY, session: 1, next: { name: "Squat", n: 2, reps: "5", kg: "140" }, restSince: "2026-10-19T10:01:00Z", restMinS: 180, restMaxS: 300, signalled: null };
  writeSnapshot(store, snap);
  assert.deepEqual(readSnapshot(store, DAY), snap);
  assert.equal(readSnapshot(store, "2026-10-20"), null);
  assert.equal(store.data.has(SNAPSHOT_KEY), false, "a snapshot from another day is cleared");
  store.data.set(SNAPSHOT_KEY, "{not json");
  assert.equal(readSnapshot(store, DAY), null);
  assert.equal(store.data.has(SNAPSHOT_KEY), false, "unreadable is discarded");
  store.data.set(SNAPSHOT_KEY, JSON.stringify({ ...snap, restSince: "yesterday-ish" }));
  assert.equal(readSnapshot(store, DAY), null);
  writeSnapshot(store, snap);
  writeSnapshot(store, null);
  assert.equal(store.data.has(SNAPSHOT_KEY), false, "Afslut clears");
  assert.doesNotThrow(() => writeSnapshot(throwing, snap));
  assert.equal(readSnapshot(throwing, DAY), null);
  assert.equal(readSnapshot(null, DAY), null);
});

test("the signal is shared: Fokus vibrates once at min, the bar never again (criterion 9)", () => {
  const store = memory();
  const since = "2026-10-19T10:00:00Z";
  writeSnapshot(store, { date: DAY, session: 1, next: { name: "Squat", n: 2, reps: "5", kg: null }, restSince: since, restMinS: 180, restMaxS: 300, signalled: null });
  const buzz: number[] = [];
  const nav = { vibrate: (ms: number) => (buzz.push(ms), true) };
  const t0 = Date.parse(since);
  const fokus = restSignal(since, 180, sharedVibrator(store, since, nav));
  fokus.tick(t0 + 178_000, true);
  fokus.tick(t0 + 179_000, true);
  assert.equal(fokus.tick(t0 + 180_000, true), true);
  assert.deepEqual(buzz, [200]);
  assert.equal(readSnapshot(store, DAY)?.signalled, since);
  // A bar that somehow looked before the crossing still doesn't buzz: the mark is set.
  const bar = restSignal(since, 180, sharedVibrator(store, since, nav));
  bar.tick(t0 + 179_000, true);
  bar.tick(t0 + 180_000, true);
  assert.deepEqual(buzz, [200]);
  // markSignalled is idempotent and keeps the snapshot
  markSignalled(store, DAY, since);
  assert.equal(readSnapshot(store, DAY)?.next.name, "Squat");
});

test("the bar's signal: none when hidden at the crossing, none after a freeze", () => {
  const since = "2026-10-19T10:00:00Z";
  const t0 = Date.parse(since);
  const buzz: number[] = [];
  const nav = { vibrate: (ms: number) => (buzz.push(ms), true) };
  const hidden = restSignal(since, 180, sharedVibrator(memory(), since, nav));
  hidden.tick(t0 + 179_000, true);
  assert.equal(hidden.tick(t0 + 180_000, false), false);
  const frozen = restSignal(since, 180, sharedVibrator(memory(), since, nav));
  frozen.tick(t0 + 100_000, true);
  assert.equal(frozen.tick(t0 + 200_000, true), false);
  assert.deepEqual(buzz, []);
});

test("captions by band, each with icon and word (criterion 8)", () => {
  const m = { min: "2", max: "3" };
  assert.deepEqual(barCaption("before", m), { icon: null, text: "Pause · 2–3 min" });
  assert.deepEqual(barCaption("ready", m), { icon: "check", text: "Klar · 2–3 min" });
  assert.deepEqual(barCaption("over", m), { icon: "warning", text: "Over 3 min" });
  assert.deepEqual(barCaption("none", null), { icon: null, text: "Pause" });
});

test("Minimér is refused while the queue is halted (criterion 3)", () => {
  assert.equal(minimiseAction(true), "refuse");
  assert.equal(minimiseAction(false), "flush");
  assert.equal(MINIMISE_REFUSED, "Kan ikke minimere, før ændringen er gemt. Tryk Gem igen.");
});

test("the bar's wake lock: held while shown, released on unmount and when hidden, again when visible (criterion 10)", async () => {
  let visible = true;
  const locks: { released: boolean }[] = [];
  const api = {
    request: async (): Promise<WakeLockHandle> => {
      const h = {
        released: false,
        release: async () => {
          h.released = true;
        },
      };
      locks.push(h);
      return h;
    },
  };
  const lock = wakeLockController(api, () => visible);
  await lock.hold();
  assert.equal(locks.length, 1);
  visible = false;
  await lock.visibility();
  assert.equal(locks[0].released, true, "page hidden: released");
  visible = true;
  await lock.visibility();
  assert.equal(locks.length, 2, "visible again: re-acquired");
  lock.release();
  assert.equal(locks[1].released, true, "unmount: released");
  await lock.visibility();
  assert.equal(locks.length, 2, "after unmount nothing is requested");
});
