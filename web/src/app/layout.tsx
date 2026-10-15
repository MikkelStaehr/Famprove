import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

export const metadata: Metadata = {
  title: "Træning",
  description: "Daglig fitness, træthed og form fra cykling og styrke.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  // Safe areas are handled in CSS (env(safe-area-inset-*)): the bottom bar, the top padding and,
  // below lg, the side gutters of the bar and of main (landscape notch).
  viewportFit: "cover",
};

// Self-hosted: next/font downloads the files at build time; the browser never calls Google.
// Ember's fonts (DESIGN.md Part B Type): Geist for headings, sentences, buttons and tab labels;
// Geist Mono for every number and the small uppercase captions.
const geist = Geist({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

/**
 * html, body and the fonts only. The three tabs live in the (tabs) shell (components/TabShell: its
 * own tab bar and one scroll container per page, docs/decisions/tab-shell.md); /fokus has its own
 * main (app/fokus/layout.tsx) and no tab bar.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="da" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="bg-bg font-sans text-16 font-normal text-text antialiased">
        {children}
      </body>
    </html>
  );
}
