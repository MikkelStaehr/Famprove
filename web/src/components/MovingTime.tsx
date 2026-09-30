/** Seconds as h:mm:ss, rounded to the second: 4368 -> "1:12:48", 2710 -> "0:45:10". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** An activity's moving time as written in intervals.icu style ("1:12:48"), machine-readable too. */
export function MovingTime({ seconds }: { readonly seconds: number }) {
  const total = Math.max(0, Math.round(seconds));
  const iso = `PT${Math.floor(total / 3600)}H${Math.floor((total % 3600) / 60)}M${total % 60}S`;
  return (
    <time dateTime={iso} className="tabular-nums">
      {formatClock(total)}
    </time>
  );
}

/**
 * "Styrke 1:12:48": the activity name as logged, then its moving time. Either part may be
 * missing; null when both are (the caller then drops the whole " · …" segment).
 */
export function ActivityWords({
  name,
  movingTimeS,
}: {
  readonly name: string | null;
  readonly movingTimeS: number | null;
}) {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "" && movingTimeS === null) return null;
  return (
    <>
      {trimmed}
      {trimmed !== "" && movingTimeS !== null && " "}
      {movingTimeS !== null && <MovingTime seconds={movingTimeS} />}
    </>
  );
}

export function hasActivityWords(name: string | null, movingTimeS: number | null): boolean {
  return (name?.trim() ?? "") !== "" || movingTimeS !== null;
}
