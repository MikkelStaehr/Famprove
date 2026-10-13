/**
 * The Fokus root. `data-screen="fokus"` is the route marker globals.css keys on: 14px captions, main
 * fills the viewport without the bottom bar's padding, focused controls scroll clear of the pinned
 * primary. Tokens and fonts (Inter + Chivo Mono) are app-wide since DESIGN.md Revision 5 (root
 * layout); Fokus keeps tabular figures on everything.
 */
export default function FokusLayout({ children }: LayoutProps<"/fokus">) {
  return (
    <div data-screen="fokus" className="flex flex-1 flex-col font-grotesk font-normal text-text tabular-nums">
      {children}
    </div>
  );
}
