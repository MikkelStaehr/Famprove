/**
 * Shared by /analyse (Cykel) and /analyse/styrke (reset-analyse-cykel.md §2.1): the h1, Geist 22/600.
 * Each page renders its updated line and section tabs (AnalyseHeader) right under it, then its cards
 * 12px apart (24px in the lg grid).
 */
export default function AnalyseLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="px-1 pt-1 font-sans text-22 font-semibold text-text">Analyse</h1>
      {children}
    </div>
  );
}
