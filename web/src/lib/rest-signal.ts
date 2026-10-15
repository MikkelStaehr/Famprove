/**
 * The rest's one haptic signal (fokus-flow.md §3), pure so it is tested without the DOM
 * (tests/rest-signal.test.ts). Once per rest, when the shown timer crosses `rest_min_s` while the
 * page is visible: `vibrate(200)`. Not when the first look (a load or reload) is already past the
 * minimum, not at the maximum, not when `rest_min_s` is null. Haptics are not motion, so
 * prefers-reduced-motion does not stop it; an unsupported vibrate (iOS) is a silent no-op.
 */
import { elapsedSeconds } from "./fokus-view.ts";

/** The part of `navigator` the signal needs; `vibrate` is absent where unsupported. */
export type Vibrator = { readonly vibrate?: (pattern: number) => boolean };

export const VIBRATE_MS = 200;

export type RestSignal = {
  /** One look at the clock; true exactly once, when this look crossed the minimum (the caller announces it). */
  readonly tick: (now: number, visible: boolean) => boolean;
};

export function restSignal(since: string, minS: number | null, nav: Vibrator | undefined): RestSignal {
  // null until the first look: armed only when the rest was still under the minimum then.
  let armed: boolean | null = null;
  return {
    tick(now, visible) {
      if (minS === null) return false;
      const seconds = elapsedSeconds(since, now);
      if (armed === null) {
        armed = seconds < minS;
        return false;
      }
      if (!armed || seconds < minS) return false;
      armed = false;
      if (!visible) return false; // crossed while hidden: the moment has passed
      if (typeof nav?.vibrate === "function") nav.vibrate(VIBRATE_MS);
      return true;
    },
  };
}
