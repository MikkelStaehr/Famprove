/**
 * Fokus's parts editor (slice combo-parts, spec design/specs/combo-parts.md): the editor's view
 * model, the typed-value parsers (§5), the steps (R1) and the save payload (§4). Pure: no I/O, no
 * React. The pre-fill itself is fokusView.parts (lib/set-parts partsFor).
 */
import type { FokusParts, PartValue, PartView } from "./set-parts.ts";

export const KG_STEP = 2.5;
export const REPS_STEP = 1;
/** §5: above this a typed kg is called out (the action's own bound is MAX_PART_KG). */
export const KG_WARN_ABOVE = 300;

export const KG_ERROR = "Skriv kg som et tal, fx 12,5.";
export const REPS_ERROR = "Reps skal være et helt tal over 0.";
export const KG_HIGH_ERROR = "Over 300 kg ser forkert ud. Tjek tallet.";

/** One part as the editor holds it: the typed text is kept as typed (§5: the input is kept). */
export type PartDraft = {
  readonly partNo: number;
  readonly name: string;
  readonly kgText: string;
  readonly repsText: string;
  readonly perSide: boolean;
};

/** The editor's state for one set: its drafts and whether they still need a save. */
export type PartsDraft = {
  readonly row: number;
  readonly set: number;
  readonly parts: readonly PartDraft[];
  /** True while the shown values are not known to be stored (pre-filled from last time, or edited). */
  readonly dirty: boolean;
};

/** A figure as Fokus writes it: comma decimals, no trailing zeros ("12,5", "10"). Null shows nothing. */
export function partFigure(value: number | null): string {
  if (value === null) return "";
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/** A typed kg: "" = missing (null); comma or dot decimals; ≥ 0 (0 = no added weight). Undefined = unreadable. */
export function parseKg(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "" || t === "–") return null;
  if (!/^\d+([.,]\d+)?$/.test(t)) return undefined;
  return Number(t.replace(",", "."));
}

/** Typed reps: "" = missing (null); a whole number ≥ 1. Undefined = unreadable. */
export function parseReps(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "" || t === "–") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 ? n : undefined;
}

/** §5's sentence for a typed kg, or null when it is fine. */
export function kgError(text: string): string | null {
  const kg = parseKg(text);
  if (kg === undefined) return KG_ERROR;
  if (kg !== null && kg > KG_WARN_ABOVE) return KG_HIGH_ERROR;
  return null;
}

/** §5's sentence for typed reps, or null when it is fine. */
export function repsError(text: string): string | null {
  return parseReps(text) === undefined ? REPS_ERROR : null;
}

/** R1: + / − on kg by 2.5 from the typed value; from empty, + starts at 2.5 and − does nothing. Never below 0. */
export function stepKg(text: string, direction: 1 | -1): string {
  const kg = parseKg(text);
  if (kg === undefined) return text;
  if (kg === null) return direction === 1 ? partFigure(KG_STEP) : text;
  return partFigure(Math.max(0, Math.round((kg + direction * KG_STEP) * 100) / 100));
}

/** Reps by 1; from empty, + starts at 1. Never below 1. */
export function stepReps(text: string, direction: 1 | -1): string {
  const reps = parseReps(text);
  if (reps === undefined) return text;
  if (reps === null) return direction === 1 ? String(REPS_STEP) : text;
  return String(Math.max(1, reps + direction * REPS_STEP));
}

/** Whether − can act: a value above the floor. */
export function canDecrease(text: string, kind: "kg" | "reps"): boolean {
  const v = kind === "kg" ? parseKg(text) : parseReps(text);
  return typeof v === "number" && v > (kind === "kg" ? 0 : 1);
}

/** The editor's starting state from fokusView.parts: logged values need no save; the rest are saved untouched (R2). */
export function draftFrom(parts: FokusParts): PartsDraft {
  return {
    row: parts.row,
    set: parts.set,
    parts: parts.parts.map((p: PartView) => ({
      partNo: p.partNo,
      name: p.name,
      kgText: partFigure(p.kg),
      repsText: p.reps === null ? "" : String(p.reps),
      perSide: p.perSide,
    })),
    dirty: parts.parts.some((p) => p.from !== "logged"),
  };
}

/**
 * The save's parts (§4–§5): every readable part, in part order. A part with an unreadable or
 * implausible field is left out (the rest are saved); a part with neither kg nor reps logs nothing.
 */
export function partsToSave(draft: PartsDraft): PartValue[] {
  const out: PartValue[] = [];
  for (const p of draft.parts) {
    if (kgError(p.kgText) !== null || repsError(p.repsText) !== null) continue;
    const kg = parseKg(p.kgText) ?? null;
    const reps = parseReps(p.repsText) ?? null;
    if (kg === null && reps === null) continue;
    out.push({ partNo: p.partNo, kg, reps, perSide: p.perSide });
  }
  return out;
}

/** The labels of one part's row (§3): sr names of the steppers and the toggle. */
export type PartRowLabels = {
  readonly toggle: string;
  readonly kgLess: string;
  readonly kgMore: string;
  readonly repsLess: string;
  readonly repsMore: string;
  readonly kgInput: string;
  readonly repsInput: string;
};

export function partRowLabels(name: string): PartRowLabels {
  return {
    toggle: `${name} tæller pr. side`,
    kgLess: `Færre kg, ${name}`,
    kgMore: `Flere kg, ${name}`,
    repsLess: `Færre reps, ${name}`,
    repsMore: `Flere reps, ${name}`,
    kgInput: `Kg, ${name}`,
    repsInput: `Reps, ${name}`,
  };
}

/** §2 / §11 / S15: the caption, the group's name, and (in a superset) the exercise it names. */
export function partsCaption(set: number, exercise: string | null): { readonly caption: string; readonly group: string } {
  const named = exercise === null ? "" : ` · ${exercise}`;
  return { caption: `Dele i sæt ${set}${named}`, group: `Dele i sæt ${set}${named}, valgfrit` };
}

/** §6: the failed-save line's first sentence. */
export function partsFailedText(set: number): string {
  return `Delene i sæt ${set} er ikke gemt.`;
}

/** A refused save (not today, set undone, …): nothing to retry. Copy not in the spec: the set log's refused line, per set. */
export function partsRefusedText(set: number): string {
  return `Delene i sæt ${set} blev afvist. Genindlæs siden.`;
}

/** The editor's whole view model (snapshot-tested): caption, group name and one row per part. */
export function partsEditorView(draft: PartsDraft, exercise: string | null) {
  return {
    ...partsCaption(draft.set, exercise),
    rows: draft.parts.map((p) => ({
      partNo: p.partNo,
      name: p.name,
      kg: p.kgText === "" ? "–" : p.kgText,
      reps: p.repsText === "" ? "–" : p.repsText,
      perSide: p.perSide,
      labels: partRowLabels(p.name),
    })),
    save: partsToSave(draft),
    dirty: draft.dirty,
  };
}
