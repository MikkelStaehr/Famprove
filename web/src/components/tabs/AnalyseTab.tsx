import { AnalyseCykel } from "./AnalyseCykel";
import { AnalyseStyrke } from "./AnalyseStyrke";

/**
 * Analyse (/analyse = Cykel, /analyse/styrke = Styrke; reset-analyse-cykel.md §2.1): the h1, Geist
 * 22/600, then the section's updated line and section tabs (AnalyseHeader) and its cards, 12px
 * apart (24px in the lg grid). Was app/analyse/layout.tsx: a slot's default doesn't pass through a
 * layout (docs/decisions/tab-shell.md §3).
 */
export function AnalyseTab({ section }: { readonly section: "cykel" | "styrke" }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="px-1 pt-1 font-sans text-22 font-semibold text-text">Analyse</h1>
      {section === "cykel" ? <AnalyseCykel /> : <AnalyseStyrke />}
    </div>
  );
}
