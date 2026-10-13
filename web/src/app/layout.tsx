import type { Metadata, Viewport } from "next";
import { Chivo_Mono, Inter } from "next/font/google";

import { ScreenNav } from "@/components/ScreenNav";

import "./globals.css";

export const metadata: Metadata = {
  title: "Træning",
  description: "Daglig fitness, træthed og form fra cykling og styrke.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  // Safe areas are handled in CSS (env(safe-area-inset-*)): the bottom bar, the top padding and,
  // below lg, the side gutters of the bar and of main (landscape notch).
  viewportFit: "cover",
};

// Self-hosted: next/font downloads the files at build time; the browser never calls Google.
// Instrument's fonts (DESIGN.md Part B Type, Revision 5): Inter carries headings, sentences, big
// numbers and buttons; the mono is for captions, axis labels and small numbers only. Chivo Mono,
// not JetBrains Mono: its 0 is a plain oval (JetBrains' is dotted, DM / Red Hat Mono's slashed).
const inter = Inter({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-inter", display: "swap" });
const mono = Chivo_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-instrument-mono",
  display: "swap",
});

/**
 * The nav sits outside the pages, so it also shows while a page loads or fails; absent on /fokus
 * (ScreenNav renders nothing there). DESIGN.md Part A "Layout: phone and desktop": below lg it is
 * a fixed bottom bar, so main starts 12px (or the safe-area inset) from the top and ends with the
 * bar's height + 48px; from lg it is a static top bar and main is the 1200px frame.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="da" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-bg font-sans text-16 font-normal text-text antialiased">
        <ScreenNav />
        <main className="mx-auto flex w-full max-w-content flex-col gap-4 pt-[max(12px,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(var(--bottom-bar)+3rem)] pl-[max(0.75rem,env(safe-area-inset-left))] lg:max-w-wide lg:gap-6 lg:px-8 lg:pb-12">{children}</main>
      </body>
    </html>
  );
}
