/**
 * Danish copy for the prognose on /load (design/specs/load.md §9b, §10): tooltip status, value
 * ranges and strength lines, the §10b note, the sr sentence and the disclosure terms. Pure
 * functions (no React) so `node --test` can check the copy verbatim. Values are Python's, only
 * formatted (whole TSS, U+2212); no band arithmetic here.
 */
import { type ChartPoint, NO_RECENT_WEEKS } from "./dashboard-view.ts";
import type { Band, IsoDate, ProjectedSession } from "./db/rows.ts";
import { formatDate, formatDay, formatLoad, formatSigned } from "./format.ts";

/** Disclosure term 4 (load.md §9b, rewritten 2026-10-01). */
export const PROGNOSE_TEXT =
  "Fitness, træthed og form de næste 8 uger, hvis du træner som du plejer. Cykling: dit gennemsnit for hver ugedag de sidste 28 dage (en planlagt tur erstatter dagen). Styrke: resten af blokken ud fra trænerens plan, og efter blokken dit gennemsnit pr. uge fra de seneste 4 hele uger uden deload. Det er et skøn, ikke en plan.";

/** Disclosure term 5 (load.md §10a). */
export const BAND_LABEL = "Spænd efter blokken";
export const BAND_TEXT =
  "Hvor fitness kan lande efter blokken, alt efter om dine styrkeuger bliver som den letteste eller den hårdeste af de seneste 4 hele uger. Jo længere frem, jo bredere.";

/** Tooltip status line (load.md §9c, §10c). */
export function prognoseStatus(estimate: ChartPoint["estimate"]): string {
  const after = estimate?.strengthMethod === "recent" ? " · efter blokken" : "";
  const dayEstimated = estimate?.sessions.some((s) => s.dayEstimated) ?? false;
  return `Prognose${after}${dayEstimated ? " · dag anslået" : ""}`;
}

/** " (44 til 49)" / " (−6 til +3)"; "" when the band is null or flat at whole TSS. */
export function rangeText(band: Band | null, format: (value: number) => string): string {
  if (band === null) return "";
  const low = format(band.low);
  const high = format(band.high);
  return low === high ? "" : ` (${low} til ${high})`;
}

/** Python's reasons for a session left out (tss null), in Danish. Unknown reasons get no text. */
const SKIPPED_REASON: Readonly<Record<string, string>> = {
  "no day left this week": "ingen dag tilbage i ugen",
  [NO_RECENT_WEEKS]: "endnu ingen hele uger at regne gennemsnit af",
  "no kg for any set in the plan": "ingen kg i trænerens plan",
};

/** One strength line in the prognose tooltip (load.md §10c). */
export function strengthLine(s: ProjectedSession): string {
  if (s.tss === null) {
    const reason = s.reason !== null && Object.hasOwn(SKIPPED_REASON, s.reason) ? SKIPPED_REASON[s.reason] : null;
    return `Styrke · session ${s.session} · ikke talt med${reason === null ? "" : ` (${reason})`}`;
  }
  const day = s.dayEstimated ? " · dag anslået" : "";
  if (s.method === "recent") {
    const weeks =
      s.recentWeeks === 1
        ? "den seneste uge"
        : s.recentWeeks === null
          ? "de seneste uger" // unreachable: rows.ts rejects an averaged recent session without it
          : `de seneste ${formatLoad(s.recentWeeks)} uger`;
    return `Styrke ≈ ${formatLoad(s.tss)} TSS${rangeText(s.tssBand, formatLoad)} · session ${s.session} · gennemsnit af ${weeks}${day}`;
  }
  const unscored = s.unscored !== null && s.unscored > 0 ? ` · ${formatLoad(s.unscored)} sæt uden kg ikke talt med` : "";
  return `Styrke ≈ ${formatLoad(s.tss)} TSS · session ${s.session} · fra trænerens plan${day}${unscored}`;
}

/** At the form hero (user, 2026-10-02): strength TSS rests on STRENGTH_K, an anchor, not a fit. */
export const STRENGTH_ESTIMATE_NOTE = "Styrke-TSS er et skøn (K ukalibreret).";

/** At the form hero (user, 2026-10-02): the absolute zones stay; at CTL ~11 they are coarse.
 * % of CTL was measured and rejected for now (61 % of days off the bar, 18 zone changes in 60 days). */
export const COARSE_ZONES_NOTE = "Zonerne er grove ved lav fitness.";

/** The data basis of the prognose's cycling (user, 2026-10-02): rides in the typical week's 28 days. */
export function typicalRidesNote(rides: number): string {
  if (rides === 0) return "Cyklingen i prognosen bygger på 0 ture de sidste 28 dage, så den regner kun med planlagte ture.";
  return `Cyklingen i prognosen bygger på ${rides} ${rides === 1 ? "tur" : "ture"} de sidste 28 dage.`;
}

/** load.md §10b: the note under the plot, `from` = the first `recent` prognose date. */
export function strengthUnknownNote(from: IsoDate): string {
  return `Styrke efter blokken (fra ${formatDate(from)}) er ikke med i prognosen endnu, fordi der ikke er nogen hele uger at regne et gennemsnit af. Den kommer med, når ugerne er gået.`;
}

/** "+8" -> "plus 8", "−8" -> "minus 8" (load.md §9d: the sign in words). */
export function spokenSigned(value: number): string {
  const signed = formatSigned(value);
  if (signed.startsWith("+")) return `plus ${signed.slice(1)}`;
  if (signed.startsWith("−")) return `minus ${signed.slice(1)}`;
  return signed;
}

/** load.md §10d: the sr sentence for the prognose's last day (+ the §10b sentence). */
export function prognoseSentence(end: ChartPoint, strengthUnknown: boolean): string {
  const ctl = end.bands?.ctl ?? null;
  const between = ctl === null ? "" : ` (mellem ${formatLoad(ctl.low)} og ${formatLoad(ctl.high)})`;
  const sentence = `Prognose, anslået ud fra trænerens plan og dine seneste uger: den ${formatDay(end.date)} cirka fitness ${formatLoad(end.ctl)}${between}, træthed ${formatLoad(end.atl)}, form ${spokenSigned(end.tsb)}.`;
  return strengthUnknown ? `${sentence} Styrke efter blokken er ikke med i prognosen endnu.` : sentence;
}
