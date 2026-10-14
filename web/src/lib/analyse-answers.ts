/**
 * View model for the three answer blocks on top of /analyse › Cykel (design/specs/analyse.md §12).
 * Pure; unit-tested with node --test. Python (analysis_summary) owns every number, direction and
 * sentence: verdict and detail pass through verbatim, the direction picks an arrow, and a number is
 * only formatted (decimal comma, eFTP whole W, EF 2 dp, hours 1 dp + " t"). No arithmetic, no
 * threshold decision.
 */
import { EF_TREND_MIN_RIDES, formatEf } from "./analyse-view.ts";
import type { DataError } from "./data-error.ts";
import { type AnalysisSummaryRow, type IsoDate, SUMMARY_QUESTIONS, type SummaryDirection, type SummaryQuestion } from "./db/rows.ts";
import { formatDate, formatWatts, LOCALE } from "./format.ts";

const HOURS = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatHoursDecimal = (h: number): string => `${HOURS.format(h)} t`;

export const QUESTION_TITLE: Readonly<Record<SummaryQuestion, string>> = {
  eftp: "Er jeg stærkere?",
  ef: "Bliver min base bedre?",
  volume: "Træner jeg nok?",
};

export const ARROW_WORD: Readonly<Record<SummaryDirection, string>> = {
  up: "stigende",
  down: "faldende",
  flat: "uændret",
};

export const MISSING_TEXT = "Intet svar endnu. Det daglige job regner det ud omkring kl. 05.00.";
/** The §6 honesty note, now inside block 1's "?". */
export const HONESTY =
  "eFTP er et skøn fra intervals.icu ud fra dine hårdeste indsatser, ikke et testresultat. Uden maksimale indsatser ligger den ofte for lavt.";
/** The old §5c explainer, now inside block 2's "?". */
export const EF_EXPLAINER = `EF er normaliseret watt (NP) delt med gennemsnitspuls. Stiger den, træder du flere watt for samme puls. Kun rolige ture på mindst 30 min med både watt og puls. Trendlinjen vises, hvor der er mindst ${EF_TREND_MIN_RIDES} ture inden for 28 dage.`;

/** "13. okt." in the current year, "7. sep. 2025" outside it (§12e date rule). */
function dateText(date: IsoDate, currentYear: number): string {
  const y = Number(date.slice(0, 4));
  return y === currentYear ? formatDate(date) : `${formatDate(date)} ${y}`;
}

function disclosure(question: SummaryQuestion, row: AnalysisSummaryRow | null, currentYear: number): readonly string[] {
  if (question === "eftp") {
    return [
      HONESTY,
      "Sammenligner den seneste eFTP med den seneste fra 6 uger før. Toppen er den højeste eFTP siden 1. jan. 2025.",
    ];
  }
  if (question === "ef") return [EF_EXPLAINER, "Rolig tur: IF under 0,75, mindst 30 min, med både watt og puls."];
  const target =
    row !== null && row.target !== null && row.targetSince !== null
      ? ` Målet på ${formatHoursDecimal(row.target)} pr. uge er sat ${dateText(row.targetSince, currentYear)}.`
      : "";
  return [
    `Timer er bevægelsestid på alle cykelture, også udeladte.${target} Planlagte ture er dem, du har lagt ind i planned_sessions.`,
  ];
}

export type AnswerFigure = {
  readonly arrow: SummaryDirection | null; // null: no arrow (needs_data)
  readonly number: string; // "183 W", "1,24", "0,9 t", "0 af 3", "–"
  readonly sr: string; // the arrow as a word, then the number ("uændret 183 W", "ikke registreret")
  readonly caption: string;
  readonly large: boolean; // block 1: text-56; blocks 2–3: text-48
};

export type AnswerBlock =
  | {
      readonly kind: "answer";
      readonly question: SummaryQuestion;
      readonly title: string;
      readonly figure: AnswerFigure;
      readonly verdict: string; // verbatim verdict_text
      readonly detail: string | null; // verbatim detail_text
      readonly disclosure: readonly string[];
    }
  | {
      readonly kind: "missing";
      readonly question: SummaryQuestion;
      readonly title: string;
      readonly text: string;
      readonly disclosure: readonly string[];
    };

export type AnswersView =
  | { readonly kind: "ready"; readonly blocks: readonly AnswerBlock[] }
  | { readonly kind: "error"; readonly error: DataError | null };

function numberOf(row: AnalysisSummaryRow): { readonly number: string; readonly sr: string; readonly caption: string } {
  const { value, compare } = row;
  if (row.question === "eftp") {
    if (value === null) return { number: "–", sr: "ikke registreret", caption: "eFTP nu" };
    const number = formatWatts(value);
    const caption =
      row.state === "answer" && compare !== null ? `eFTP nu · for 6 uger siden ${formatWatts(compare)}` : "eFTP nu";
    return { number, sr: number, caption };
  }
  if (row.question === "ef") {
    if (value === null) {
      const number = `${row.haveN ?? "–"} af ${row.needN ?? "–"}`;
      return { number, sr: number, caption: "rolige ture med puls og watt de sidste 28 dage" };
    }
    // needs_data with a value keeps the number (like block 1's "eFTP nu"); no arrow (answerBlock).
    const caption =
      row.state === "needs_data"
        ? "EF på rolige ture nu"
        : compare === null
          ? "EF på rolige ture"
          : `EF på rolige ture · for 6 uger siden ${formatEf(compare)}`;
    return { number: formatEf(value), sr: formatEf(value), caption };
  }
  // volume: value and target are never null (parser); 0 is a real zero.
  const number = value === null ? "–" : formatHoursDecimal(value);
  const target = row.target === null ? "–" : formatHoursDecimal(row.target);
  return {
    number,
    sr: value === null ? "ikke registreret" : number,
    caption: `pr. uge, snit af de sidste 4 hele uger · mål ${target}`,
  };
}

export function answerBlock(question: SummaryQuestion, row: AnalysisSummaryRow | null, currentYear: number): AnswerBlock {
  const title = QUESTION_TITLE[question];
  const disc = disclosure(question, row, currentYear);
  if (row === null) return { kind: "missing", question, title, text: MISSING_TEXT, disclosure: disc };
  const arrow = row.state === "answer" ? row.direction : null;
  const n = numberOf(row);
  return {
    kind: "answer",
    question,
    title,
    figure: {
      arrow,
      number: n.number,
      sr: arrow === null ? n.sr : `${ARROW_WORD[arrow]} ${n.sr}`,
      caption: n.caption,
      large: question === "eftp",
    },
    verdict: row.verdictText,
    detail: row.detailText,
    disclosure: disc,
  };
}

/**
 * The three blocks in the spec's order. `summary` null = the read failed (§12d: an ErrorState in
 * place of the blocks, the charts unaffected); a question without a row shows MISSING_TEXT.
 */
export function buildAnswers(
  summary: readonly AnalysisSummaryRow[] | null | undefined,
  error: DataError | null | undefined,
  currentYear: number,
): AnswersView {
  if (summary === null || summary === undefined) return { kind: "error", error: error ?? null };
  return {
    kind: "ready",
    blocks: SUMMARY_QUESTIONS.map((q) => answerBlock(q, summary.find((r) => r.question === q) ?? null, currentYear)),
  };
}
