/**
 * The exercise catalogue's name matching (public.exercises), shared by the training views and the
 * week card (bw-display): trimmed, case-insensitive, a canonical name winning over another
 * exercise's alias, as the server matches. Its own module, since training-view imports
 * dashboard-view and the week card's builder needs it too.
 */
import type { ExerciseCategory, ExerciseCategoryRow } from "./db/rows.ts";

/** A catalogue key: trimmed, case-insensitive (as lib/db/set-log.ts and public.exercises' lower(btrim(name))). */
export function catalogueKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The catalogue's category per name and alias key, matched as the server matches: a canonical name
 * wins over another exercise's alias. A failed read (null) is null.
 */
export function catalogueCategories(
  rows: readonly Pick<ExerciseCategoryRow, "name" | "aliases" | "category">[] | null,
): ReadonlyMap<string, ExerciseCategory> | null {
  if (rows === null) return null;
  const category = new Map<string, ExerciseCategory>();
  for (const r of rows) if (!category.has(catalogueKey(r.name))) category.set(catalogueKey(r.name), r.category);
  for (const r of rows) for (const a of r.aliases) if (!category.has(catalogueKey(a))) category.set(catalogueKey(a), r.category);
  return category;
}

/** A sheet name's catalogue category; null = catalogue unread or the name not in it. */
export type CategoryOf = (name: string) => ExerciseCategory | null;

export function categoryLookup(rows: readonly ExerciseCategoryRow[] | null): CategoryOf {
  const map = catalogueCategories(rows);
  return (name) => map?.get(catalogueKey(name)) ?? null;
}
