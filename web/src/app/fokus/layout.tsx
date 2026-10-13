import { Chivo_Mono, Inter } from "next/font/google";

// Instrument's fonts (DESIGN.md Part B Type), self-hosted by next/font and loaded on /fokus only.
// Inter carries every big number, heading and button (tabular figures, set on the root below).
const inter = Inter({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-inter", display: "swap" });
// The mono is for captions, axis labels and small numbers only. Chivo Mono, not JetBrains Mono:
// JetBrains Mono's plain 0 is dotted (and DM / Red Hat Mono's slashed); Chivo Mono's is a plain oval.
const mono = Chivo_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-instrument-mono",
  display: "swap",
});

/** The Instrument scope (design/specs/fokus-instrument.md §0): its tokens apply inside this root only. */
export default function FokusLayout({ children }: LayoutProps<"/fokus">) {
  return (
    <div data-direction="instrument" className={`bg-bg ${inter.variable} ${mono.variable} flex flex-col font-grotesk font-normal text-text tabular-nums`}>
      {children}
    </div>
  );
}
