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

/** Tailwind fill utility per zone (the --zone-* tokens), shared by ZoneBar and the /load explainer. */
export const ZONE_FILL: Readonly<Record<ZoneKey, string>> = {
  high_risk: "bg-zone-risk",
  optimal: "bg-zone-optimal",
  grey_zone: "bg-zone-grey",
  fresh: "bg-zone-fresh",
  transition: "bg-zone-transition",
};

/**
 * Each zone's range in words, built from THRESHOLDS so it can't drift from form.py (the sync
 * test guards THRESHOLDS). Inclusivity as form.py: −30 and −10 belong to the lower zone, 5 and
 * 20 to the higher. `visible` uses U+2212; `spoken` writes "minus" out for screen readers.
 */
export const ZONE_RANGE: Readonly<Record<ZoneKey, { readonly visible: string; readonly spoken: string }>> =
  (() => {
    const [risk, optimal, fresh, transition] = THRESHOLDS as readonly [number, number, number, number];
    const words = (sign: (n: number) => string) => ({
      high_risk: `${sign(risk)} og lavere`,
      optimal: `over ${sign(risk)} til og med ${sign(optimal)}`,
      grey_zone: `over ${sign(optimal)} til under ${sign(fresh)}`,
      fresh: `${sign(fresh)} til under ${sign(transition)}`,
      transition: `${sign(transition)} og højere`,
    });
    const visible = words((n) => (n < 0 ? `\u2212${-n}` : `${n}`));
    const spoken = words((n) => (n < 0 ? `minus ${-n}` : `${n}`));
    const keys = Object.keys(visible) as ZoneKey[];
    return Object.fromEntries(keys.map((k) => [k, { visible: visible[k], spoken: spoken[k] }])) as Record<
      ZoneKey,
      { readonly visible: string; readonly spoken: string }
    >;
  })();

/** A TSB number written out for screen readers: 4 -> "plus 4", −12 -> "minus 12", 0 -> "0". */
function spokenSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `plus ${rounded}`;
  if (rounded < 0) return `minus ${Math.abs(rounded)}`;
  return "0";
}

/** Each band's name and range as spoken (design/specs/today.md §5a, ZoneBar sr sentence). */
const SPOKEN_BAND: Readonly<Record<ZoneKey, string>> = {
  high_risk: "høj risiko, minus 30 og lavere",
  optimal: "optimal, som går fra minus 30 til minus 10",
  grey_zone: "gråzone, som går fra minus 10 til 5",
  fresh: "frisk, som går fra 5 til 20",
  transition: "overgang, 20 og højere",
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

/** What each zone means for training today (design/specs/load.md §8a). */
const READING: Readonly<Record<ZoneKey, string>> = {
  high_risk: "Du er langt mere træt, end din fitness kan bære. Tag lette dage, før du belaster igen.",
  optimal: "Du er træt på den gode måde: belastningen bygger fitness op.",
  grey_zone: "Du er hverken træt nok til at bygge fitness eller frisk nok til at præstere.",
  fresh: "Du er frisk og klar til at præstere, men fitness bygges ikke op lige nu.",
  transition: "Du er så frisk, at fitness falder. Fint i en pause, ellers er det tid til at træne.",
};

/**
 * `/load`'s one-sentence zone reading under the hero, from daily_load.form_zone as-is (never
 * from TSB). null or an unknown key: the "can't interpret" sentence. The caller renders nothing
 * when there is no TSB at all.
 */
export function zoneReading(zone: string | null): string {
  return isZoneKey(zone)
    ? READING[zone]
    : "Uden zone kan dagens form ikke tolkes. Brug tallet på skalaen ovenfor.";
}
