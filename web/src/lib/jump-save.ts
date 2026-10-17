/**
 * What the screen does when a jump's save is refused (the server says `invalid`), given whether any
 * tap came after the jump. Nothing after it: put back the order and the log the jump replaced
 * ("revert"). A later tap built on the moved log, so putting the order back would show a state the
 * server doesn't have: "reload" (useSetLog's rejected state). A jump that only failed is never
 * reverted: it waits in the queue for Gem igen (onJumpResult).
 */
export function jumpFailure(tapsSinceJump: boolean): "revert" | "reload" {
  return tapsSinceJump ? "reload" : "revert";
}

/** A save's outcome as the action reports it (useSetLog maps the result; a throw is "failed"). */
export type SaveOutcome = "saved" | "dev" | "failed" | "refused";

export type Tap = { readonly kind: string };

/**
 * The save queue (slice jump-retry, user 2026-10-17): a failed jump, queued or not, never vanishes.
 * It goes into `failed` and halts the queue: every later tap (jump or not) stays on screen but is
 * held behind it, unsent, until Gem igen saves the jump, so server and client never order
 * differently. Gem igen sends `failed` in order; a jump failing again halts again.
 */
export type SaveState<T extends Tap> = {
  /** Taps Gem igen sends again, in order: failed saves, and while `halted` the jump and every tap after it. */
  readonly failed: readonly T[];
  /** A jump in `failed` waits: nothing more is sent until Gem igen saves it. */
  readonly halted: boolean;
  /** A tap or a jump was refused: reload the page. */
  readonly reload: boolean;
  /** A jump was refused after later taps: they are built on an order the server refused, so none is sent. */
  readonly stopped: boolean;
  /** The dev switches are on: nothing is saved. */
  readonly dev: boolean;
};

export const NO_SAVES: SaveState<never> = { failed: [], halted: false, reload: false, stopped: false, dev: false };

/** A jump's save came back. Refused with nothing after it: the caller reverts (jumpFailure). */
export function onJumpResult<T extends Tap>(state: SaveState<T>, jump: T, outcome: SaveOutcome, tapsSinceJump: boolean): SaveState<T> {
  switch (outcome) {
    case "saved":
      return state;
    case "dev":
      return { ...state, dev: true };
    case "failed":
      return { ...state, failed: [...state.failed, jump], halted: true };
    case "refused":
      return jumpFailure(tapsSinceJump) === "reload" ? { ...state, reload: true, stopped: true } : state;
  }
}

/** Any other tap's save came back: a failure waits for Gem igen without halting; a refusal reloads. */
export function onTapResult<T extends Tap>(state: SaveState<T>, tap: T, outcome: SaveOutcome): SaveState<T> {
  switch (outcome) {
    case "saved":
      return state;
    case "dev":
      return { ...state, dev: true };
    case "failed":
      return { ...state, failed: [...state.failed, tap] };
    case "refused":
      return { ...state, reload: true };
  }
}

/** A tap's turn came while the queue is halted (held behind the failed jump) or stopped (dropped). */
export function onHeld<T extends Tap>(state: SaveState<T>, tap: T): SaveState<T> {
  return state.halted ? { ...state, failed: [...state.failed, tap] } : state;
}

/** True when a tap whose turn has come is sent now. */
export function sendable<T extends Tap>(state: SaveState<T>): boolean {
  return !state.halted && !state.stopped;
}

/** The failed taps before the halting jump (the ones after it are held, said by the jump's line). */
export function failedBeforeJump<T extends Tap>(state: SaveState<T>): readonly T[] {
  const at = state.failed.findIndex((f) => f.kind === "jump");
  return at === -1 ? state.failed : state.failed.slice(0, at);
}

/** The jump that halts the queue, if any. */
export function haltingJump<T extends Tap>(state: SaveState<T>): T | null {
  return state.halted ? (state.failed.find((f) => f.kind === "jump") ?? null) : null;
}

export type SaveQueue<T extends Tap> = {
  /**
   * Queues a tap's save behind every earlier one. `send` makes the request (called again by Gem
   * igen, so it reads what it needs at send time); `revert` puts back what a jump replaced (refused,
   * nothing after it).
   */
  readonly push: (input: T, send: () => Promise<SaveOutcome>, revert?: () => void) => void;
  /** Gem igen: sends `failed` in order (the jump, then the held taps), behind anything still queued. */
  readonly retry: () => void;
  /** Drops failed or held taps that `keep` rejects (never a jump): the undo rule. */
  readonly drop: (keep: (input: T) => boolean) => void;
  readonly flush: () => Promise<void>;
  readonly state: () => SaveState<T>;
};

/**
 * Sends taps one at a time, in order, each through its own `send`. A retry sends the same input, so the
 * server applies the same transition at its own time and writes its order mark last, as on the
 * first try (Multi-request writes).
 */
export function createSaveQueue<T extends Tap>(
  change: (state: SaveState<T>) => void,
): SaveQueue<T> {
  let state: SaveState<T> = NO_SAVES;
  let chain: Promise<void> = Promise.resolve();
  let pushes = 0;
  const seqOf = new WeakMap<T, number>();
  const revertOf = new WeakMap<T, () => void>();
  const sendOf = new WeakMap<T, () => Promise<SaveOutcome>>();
  const set = (next: SaveState<T>) => {
    if (next === state) return;
    state = next;
    change(state);
  };

  const send = async (input: T): Promise<void> => {
    if (!sendable(state)) {
      set(onHeld(state, input));
      return;
    }
    let outcome: SaveOutcome = "failed";
    try {
      const request = sendOf.get(input);
      if (request !== undefined) outcome = await request();
    } catch {
      // offline, or a deployment that no longer knows this action: failed
    }
    if (input.kind !== "jump") {
      set(onTapResult(state, input, outcome));
      return;
    }
    const since = pushes !== seqOf.get(input);
    if (outcome === "refused" && jumpFailure(since) === "revert") revertOf.get(input)?.();
    set(onJumpResult(state, input, outcome, since));
  };

  return {
    push: (input, request, revert) => {
      pushes += 1;
      seqOf.set(input, pushes);
      sendOf.set(input, request);
      if (revert !== undefined) revertOf.set(input, revert);
      chain = chain.then(() => send(input));
    },
    retry: () => {
      chain = chain.then(async () => {
        const pending = state.failed;
        set({ ...state, failed: [], halted: false });
        for (const input of pending) await send(input);
      });
    },
    drop: (keep) => {
      const failed = state.failed.filter((f) => f.kind === "jump" || keep(f));
      if (failed.length !== state.failed.length) set({ ...state, failed });
    },
    flush: () => chain,
    state: () => state,
  };
}
