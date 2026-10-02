/**
 * The competition lifts, in display order, and their Danish names: one list for the data layer
 * (rows.ts) and the views. Not server-only, so client components can import it. Mirrors
 * Python's domain.strength_analysis.LIFTS.
 */
export const LIFTS = ["SQUAT", "BENCH", "DEADLIFT"] as const;

export type StrengthLift = (typeof LIFTS)[number];

/** A value per lift, in one typed record (no array index, so no `?? 0` fallbacks). */
export function perLift<T>(f: (lift: StrengthLift) => T): Readonly<Record<StrengthLift, T>> {
  return { SQUAT: f("SQUAT"), BENCH: f("BENCH"), DEADLIFT: f("DEADLIFT") };
}

export const LIFT_NAME: Readonly<Record<StrengthLift, string>> = {
  SQUAT: "Squat",
  BENCH: "Bænkpres",
  DEADLIFT: "Dødløft",
};
