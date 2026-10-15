/**
 * The screen wake lock for a Fokus session (fokus-flow.md §4), pure so it is tested with a fake
 * API (tests/wake-lock.test.ts). `hold` from entering an open session; `visibility` re-requests
 * when the page is visible again (the browser drops the lock when hidden); `release` on the
 * finished view and on leaving. Unsupported (no API) or refused: silent, nothing shown.
 */

/** The parts of `WakeLockSentinel` / `navigator.wakeLock` used here. */
export type WakeLockHandle = { readonly released: boolean; release(): Promise<void> };
export type WakeLockApi = { request(type: "screen"): Promise<WakeLockHandle> };

export type WakeLockController = {
  readonly hold: () => Promise<void>;
  readonly visibility: () => Promise<void>;
  readonly release: () => void;
};

export function wakeLockController(api: WakeLockApi | undefined, visible: () => boolean): WakeLockController {
  let held: WakeLockHandle | null = null;
  let wanted = false;
  let requesting = false;

  const drop = () => {
    const h = held;
    held = null;
    h?.release().catch(() => undefined); // already released by the browser: fine
  };
  const request = async () => {
    if (api === undefined || !wanted || requesting || !visible()) return;
    if (held !== null && !held.released) return;
    requesting = true;
    try {
      const lock = await api.request("screen");
      if (wanted && visible()) held = lock;
      else lock.release().catch(() => undefined);
    } catch {
      // refused (battery saver, no user activation): an enhancement only
    } finally {
      requesting = false;
    }
  };

  return {
    hold() {
      wanted = true;
      return request();
    },
    visibility() {
      if (visible()) return request();
      drop();
      return Promise.resolve();
    },
    release() {
      wanted = false;
      drop();
    },
  };
}
