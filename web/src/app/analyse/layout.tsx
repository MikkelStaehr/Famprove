/** Shared by /analyse (Cykel) and /analyse/styrke (analyse-styrke.md §2): the h1; each page renders its tabs. */
export default function AnalyseLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <>
      <h1 className="font-sans text-28 font-normal">Analyse</h1>
      {children}
    </>
  );
}
