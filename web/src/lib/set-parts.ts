/**
 * Combined-variant parts (slice combo-parts, spec design/specs/combo-parts.md; user 2026-10-17):
 * each part of a variant such as "Palloff + weighted situps" has its own kg, reps and "tæller pr.
 * side" in the app's log (public.exercise_set_parts), because the sheet has one WEIGHT cell.
 * Pure: the action's input parser, the result type and Fokus's pre-fill. No I/O. Python never
 * reads the tables, so TSS is unchanged (ABS keeps the formula's fixed score).
 */
import type { IsoDate } from "./db/rows.ts";
import { setKey, type SetRef } from "./set-taps.ts";

export const MAX_PART_KG = 500;
export const MAX_PART_REPS = 200;
const MAX_SESSION = 14;
const MAX_ROW = 10_000;
const MAX_SET = 100;
const MAX_PART = 20;

/** One part as the client sends it: kg ≥ 0 (0 = no added weight) or null; reps > 0 or null (missing, never 0). */
export type PartValue = {
  readonly partNo: number;
  readonly kg: number | null;
  readonly reps: number | null;
  readonly perSide: boolean;
};

export type SetPartsInput = {
  readonly date: IsoDate;
  readonly sessionNo: number;
  readonly row: number;
  readonly set: number;
  readonly parts: readonly PartValue[];
};

/** What one save stores (or, under a dev switch, would store): the set and its parts. */
export type StoredParts = { readonly row: number; readonly set: number; readonly parts: readonly PartValue[] };

export type SetPartsResult =
  | { readonly ok: true; readonly dev: boolean; readonly stored: StoredParts }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "not_today" | "no_set" | "not_done" | "no_parts" | "unknown_part" | "failed";
    };

/** public.exercise_variant_parts: a variant's part, hand-edited. */
export type VariantPartRow = {
  readonly variantId: number;
  readonly partNo: number;
  readonly name: string;
  readonly perSide: boolean; // the default for "tæller pr. side"
};

/** public.exercise_set_parts: one part of a done set. */
export type SetPartRow = {
  readonly date: IsoDate;
  readonly session: number;
  readonly row: number;
  readonly set: number;
  readonly partNo: number;
  readonly variantId: number;
  readonly kg: number | null; // 0 = no added weight; null = not logged
  readonly reps: number | null; // never 0; null = not logged
  readonly perSide: boolean;
  readonly updatedAt: string;
};

/** What the parts editor reads for a session: the variants' parts, today's logged parts, and earlier days' latest per part. */
export type PartsData = {
  readonly variantParts: readonly VariantPartRow[];
  readonly today: readonly SetPartRow[]; // today's rows, every session
  readonly last: readonly SetPartRow[]; // before today: the latest row per (variant, part)
};

export const NO_PARTS: PartsData = { variantParts: [], today: [], last: [] };

/** One part in the editor, pre-filled: this set's logged row, else the last time, else the default. */
export type PartView = {
  readonly partNo: number;
  readonly name: string;
  readonly kg: number | null;
  readonly reps: number | null;
  readonly perSide: boolean;
  readonly from: "logged" | "last" | "default";
};

/** fokusView.parts: the editor after the done of a set whose variant has parts. */
export type FokusParts = { readonly row: number; readonly set: number; readonly parts: readonly PartView[] };

function whole(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function kgOf(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PART_KG ? value : undefined;
}

function repsOf(value: unknown): number | null | undefined {
  if (value === null) return null;
  return whole(value, 1, MAX_PART_REPS) ?? undefined;
}

/** The action's input from an untrusted client: exact shape or null (a part listed twice is invalid). */
export function parseSetPartsInput(raw: unknown): SetPartsInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const sessionNo = whole(r.sessionNo, 1, MAX_SESSION);
  const row = whole(r.row, 1, MAX_ROW);
  const set = whole(r.set, 1, MAX_SET);
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || sessionNo === null || row === null || set === null) return null;
  if (!Array.isArray(r.parts) || r.parts.length === 0 || r.parts.length > MAX_PART) return null;
  const parts: PartValue[] = [];
  for (const p of r.parts as unknown[]) {
    if (typeof p !== "object" || p === null) return null;
    const q = p as Record<string, unknown>; // narrowed field by field below
    const partNo = whole(q.partNo, 1, MAX_PART);
    const kg = kgOf(q.kg);
    const reps = repsOf(q.reps);
    if (partNo === null || kg === undefined || reps === undefined || typeof q.perSide !== "boolean") return null;
    if (parts.some((x) => x.partNo === partNo)) return null;
    parts.push({ partNo, kg, reps, perSide: q.perSide });
  }
  return { date: r.date, sessionNo, row, set, parts };
}

/** Earlier days' rows → the latest per (variant, part), by date then updated_at. */
export function latestPerPart(rows: readonly SetPartRow[]): SetPartRow[] {
  const best = new Map<string, SetPartRow>();
  for (const r of rows) {
    const k = `${r.variantId}#${r.partNo}`;
    const b = best.get(k);
    if (b === undefined || r.date > b.date || (r.date === b.date && r.updatedAt > b.updatedAt)) best.set(k, r);
  }
  return [...best.values()].toSorted((a, b) => a.variantId - b.variantId || a.partNo - b.partNo);
}

/**
 * The editor for a done set of `session` (combo-parts.md §4): per part in part order, this set's
 * logged row wins; then the last time that part was logged (an earlier set today, else an earlier
 * day); then the variant's default per-side with kg and reps empty (null, never 0). Null when the
 * variant has no parts.
 */
export function partsFor(data: PartsData, session: number, ref: SetRef, variantId: number | null): FokusParts | null {
  if (variantId === null) return null;
  const parts = data.variantParts.filter((p) => p.variantId === variantId).toSorted((a, b) => a.partNo - b.partNo);
  if (parts.length === 0) return null;
  const own = (r: SetPartRow) => r.session === session && setKey({ row: r.row, set: r.set }) === setKey(ref);
  return {
    row: ref.row,
    set: ref.set,
    parts: parts.map((p) => {
      const same = (r: SetPartRow) => r.variantId === variantId && r.partNo === p.partNo;
      const logged = data.today.find((r) => same(r) && own(r));
      if (logged !== undefined) return { partNo: p.partNo, name: p.name, kg: logged.kg, reps: logged.reps, perSide: logged.perSide, from: "logged" };
      const earlierToday = data.today.filter((r) => same(r) && !own(r)).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const last = earlierToday ?? latestPerPart(data.last.filter(same))[0];
      if (last !== undefined) return { partNo: p.partNo, name: p.name, kg: last.kg, reps: last.reps, perSide: last.perSide, from: "last" };
      return { partNo: p.partNo, name: p.name, kg: null, reps: null, perSide: p.perSide, from: "default" };
    }),
  };
}
