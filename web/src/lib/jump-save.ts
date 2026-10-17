/**
 * What the screen does when a jump's save does not land (failed or refused), given whether any
 * tap came after the jump. Nothing after it: put back the order and the log the jump replaced
 * ("revert"). A later tap built on the moved log, so putting the order back would show a state the
 * server doesn't have: "reload" (useSetLog's rejected state).
 */
export function jumpFailure(tapsSinceJump: boolean): "revert" | "reload" {
  return tapsSinceJump ? "reload" : "revert";
}
