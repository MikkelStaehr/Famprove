/**
 * The Fokus root. `data-screen="fokus"` is the route marker globals.css keys on: main fills the
 * viewport without the bottom bar's padding, and focused controls scroll clear of the pinned
 * primary. Captions are Fokus's own 13px MonoCaption (components/fokus/Instrument CAPTION); Geist
 * and Geist Mono come from the root layout. reset-fokus.md §6: one centred column, max 480px, at
 * every width (the dock lives inside it, so it is the same width); no tab bar.
 */
export default function FokusLayout({ children }: LayoutProps<"/fokus">) {
  return (
    <div data-screen="fokus" className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col font-sans font-normal text-text tabular-nums">
      {children}
    </div>
  );
}
