/**
 * The zone bar's drawing scale (DESIGN.md Part B › Zone bar). Pure; no I/O, no React.
 *
 * The thresholds here only DRAW the bands. Which zone is active always comes from
 * daily_load.form_zone (Python, python/src/training_load/domain/form.py); the UI never
 * classifies a TSB itself. tests/zone-scale.test.ts fails if these numbers drift from
 * form.py's FORM_ZONES.
 */

/** The bar spans −40 … +30 TSS/day, linear. */
export const SCALE_MIN = -40;
export const SCALE_MAX = 30;

/** form.py's FormZone values, low to high. */
export type ZoneKey = "high_risk" | "optimal" | "grey_zone" | "fresh" | "transition";

export type Band = {
  readonly key: ZoneKey;
  readonly lower: number | null; // TSB where the band starts (form.py's `lower`); null = no floor
  readonly start: number; // left edge on the bar, 0..1
  readonly end: number; // right edge on the bar, 0..1
};

/** Lower bounds per band, low to high (intervals.icu: −30, −10, 5, 20). */
const LOWERS: readonly (readonly [ZoneKey, number | null])[] = [
  ["high_risk", null],
  ["optimal", -30],
  ["grey_zone", -10],
  ["fresh", 5],
  ["transition", 20],
];

/** Where `tsb` sits on the bar, 0..1, clamped to the scale ends. */
export function position(tsb: number): number {
  const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, tsb));
  return (clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
}

/** Which end the marker is pinned to when `tsb` is off the scale, else null. */
export function pinned(tsb: number): "low" | "high" | null {
  return tsb < SCALE_MIN ? "low" : tsb > SCALE_MAX ? "high" : null;
}

export const BANDS: readonly Band[] = LOWERS.map(([key, lower], i) => {
  const next = LOWERS[i + 1];
  return {
    key,
    lower,
    start: lower === null ? 0 : position(lower),
    end: next === undefined ? 1 : position(next[1] ?? SCALE_MIN),
  };
});

/** The threshold numbers printed under the bar: −30, −10, 5, 20. */
export const THRESHOLDS: readonly number[] = BANDS.flatMap((b) => (b.lower === null ? [] : [b.lower]));

/** A TSB number written out for screen readers: 4 -> "plus 4", −12 -> "minus 12", 0 -> "0". */
function spokenSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `plus ${rounded}`;
  if (rounded < 0) return `minus ${Math.abs(rounded)}`;
  return "0";
}

/** Each band's name and range as spoken (design/specs/today.md §5a, ZoneBar sr sentence). */
const SPOKEN_BAND: Readonly<Record<ZoneKey, string>> = {
  high_risk: "høj risiko, under minus 30",
  optimal: "optimal, som går fra minus 30 til minus 10",
  grey_zone: "gråzone, som går fra minus 10 til 5",
  fresh: "frisk, som går fra 5 til 20",
  transition: "overgang, over 20",
};

export function isZoneKey(key: string | null): key is ZoneKey {
  return key !== null && Object.hasOwn(SPOKEN_BAND, key);
}

/**
 * The zone bar's one sr-only sentence, e.g. "Form plus 4 TSS per dag: gråzone, som går fra
 * minus 10 til 5." `zone` is daily_load.form_zone as-is (never derived from `tsb` here);
 * `fromDate` is the spoken date when the row is not today's ("søndag 27. september").
 */
export function zoneSentence(tsb: number, zone: string | null, fromDate?: string): string {
  const value = `Form ${spokenSigned(tsb)} TSS per dag`;
  const parts = [isZoneKey(zone) ? `${value}: ${SPOKEN_BAND[zone]}.` : `${value}. Zone ikke beregnet.`];
  if (pinned(tsb) !== null) parts.push("Uden for skalaen, som går fra minus 40 til 30.");
  if (fromDate !== undefined) parts.push(`Tallet er fra ${fromDate}.`);
  return parts.join(" ");
}
