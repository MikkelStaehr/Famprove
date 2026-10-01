/**
 * The competition lifts, in display order, and their Danish names: one list for the data layer
 * (rows.ts) and the views. Not server-only, so client components can import it. Mirrors
 * Python's domain.strength_analysis.LIFTS.
 */
export const LIFTS = ["SQUAT", "BENCH", "DEADLIFT"] as const;

export type StrengthLift = (typeof LIFTS)[number];

export const LIFT_NAME: Readonly<Record<StrengthLift, string>> = {
  SQUAT: "Squat",
  BENCH: "Bænkpres",
  DEADLIFT: "Dødløft",
};
