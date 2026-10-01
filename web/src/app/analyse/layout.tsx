/** Shared by /analyse (Cykel) and /analyse/styrke (analyse-styrke.md §2): the h1; each page renders its tabs. */
export default function AnalyseLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <>
      <h1 className="font-display text-44 font-extrabold tracking-[-0.01em] uppercase italic">Analyse</h1>
      {children}
    </>
  );
}
