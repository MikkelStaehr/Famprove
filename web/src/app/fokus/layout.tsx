import { Inter, JetBrains_Mono } from "next/font/google";

// Instrument's fonts (DESIGN.md Part B Type), self-hosted by next/font and loaded on /fokus only.
const inter = Inter({ subsets: ["latin"], weight: ["400"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/** The Instrument scope (design/specs/fokus-instrument.md §0): its tokens apply inside this root only. */
export default function FokusLayout({ children }: LayoutProps<"/fokus">) {
  return (
    <div data-direction="instrument" className={`${inter.variable} ${mono.variable} flex flex-col font-grotesk font-normal text-text`}>
      {children}
    </div>
  );
}
