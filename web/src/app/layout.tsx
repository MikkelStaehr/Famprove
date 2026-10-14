import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TabBar } from "@/components/TabBar";

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
 * The nav sits outside the pages, so it also shows while a page loads or fails; absent on /fokus
 * (TabBar renders nothing there). DESIGN.md Part A "Layout: phone and desktop": below lg the nav is
 * a fixed bottom bar, so main has 20px (or the safe-area inset) on top, 16px gutters, 12px between
 * cards and ends with the bar's height + 24px; from lg it is a static top bar and main is the
 * 1200px frame (32px gutters, 24px gap). Screens set their own grid inside it.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="da" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="bg-bg font-sans text-16 font-normal text-text antialiased">
        <TabBar />
        <main className="mx-auto flex w-full max-w-content flex-col gap-3 pt-[max(20px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-[calc(var(--bottom-bar)+24px)] pl-[max(16px,env(safe-area-inset-left))] lg:max-w-wide lg:gap-6 lg:px-8 lg:pt-0 lg:pb-12">{children}</main>
      </body>
    </html>
  );
}
