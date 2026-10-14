import { SIG_BASELINE, SIG_WIDTH, showsKgReminder, type Signature } from "@/lib/fokus-marks";

/**
 * The finished view's session signature (fokus-round4.md §3.3): one bar per done set, gaps = time
 * between done taps, solid = reps × kg, hollow = by reps (kg not in the sheet yet), rating as shade
 * plus a marker. A drawing only (lib/fokus-marks): no number on it; the figcaption says the counts.
 */
export function SessionSignature({ marks }: { readonly marks: Signature }) {
  return (
    <figure className="mt-4 flex flex-col gap-2">
      <svg aria-hidden="true" viewBox={`0 0 ${SIG_WIDTH} 128`} className="block h-auto w-full" data-signature>
        <rect x={0} y={SIG_BASELINE} width={SIG_WIDTH} height={1} fill="var(--text-muted)" />
        {/* A skipped set: a small × across the baseline (not a square, which is Hårdere's marker). */}
        {marks.stubs.map((st) => {
          const half = st.w / 2;
          const cy = SIG_BASELINE + 0.5;
          return (
            <path
              key={`s${st.x}`}
              data-skipped
              d={`M${st.x} ${cy - half}L${st.x + st.w} ${cy + half}M${st.x + st.w} ${cy - half}L${st.x} ${cy + half}`}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1.25}
            />
          );
        })}
        {marks.bars.map((b) => {
          const colour = b.muted ? "var(--text-muted)" : "var(--text)";
          const mid = b.x + b.w / 2;
          return (
            <g key={`b${b.x}`} data-hollow={b.hollow}>
              {b.hollow ? (
                <rect x={b.x + 0.5} y={SIG_BASELINE - b.h + 0.5} width={Math.max(0, b.w - 1)} height={b.h - 1} fill="none" stroke={colour} strokeWidth={1} />
              ) : (
                <rect x={b.x} y={SIG_BASELINE - b.h} width={b.w} height={b.h} fill={colour} />
              )}
              {b.marker === "ring" && <circle cx={mid} cy={10} r={2} fill="none" stroke={colour} strokeWidth={1} />}
              {b.marker === "dash" && <rect x={mid - 2} y={9.5} width={4} height={1} fill={colour} />}
              {b.marker === "square" && <rect x={mid - 2} y={8} width={4} height={4} fill={colour} />}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-col gap-1 font-mono text-13 text-text-muted">
        <p aria-hidden="true" className="flex flex-wrap items-center gap-x-2">
          <Glyph kind="ring" /> Lettere · <Glyph kind="dash" /> Som ventet · <Glyph kind="square" /> Hårdere ·{" "}
          <Glyph kind="cross" /> sprunget over
        </p>
        {showsKgReminder(marks) && <p>Hul søjle: kg ikke i arket endnu. Husk at logge den.</p>}
      </div>
      <figcaption className="sr-only">{marks.sentence}</figcaption>
    </figure>
  );
}

function Glyph({ kind }: { readonly kind: "ring" | "dash" | "square" | "cross" }) {
  return (
    <svg viewBox="0 0 10 10" className="inline-block size-2.5 shrink-0">
      {kind === "ring" && <circle cx={5} cy={5} r={4} fill="none" stroke="currentColor" strokeWidth={1.25} />}
      {kind === "dash" && <rect x={0} y={4.5} width={10} height={1.25} fill="currentColor" />}
      {kind === "square" && <rect x={1} y={1} width={8} height={8} fill="currentColor" />}
      {kind === "cross" && <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" fill="none" stroke="currentColor" strokeWidth={1.25} />}
    </svg>
  );
}
