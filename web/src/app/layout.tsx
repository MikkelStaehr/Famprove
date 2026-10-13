import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";

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
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  style: ["normal", "italic"],
  variable: "--font-barlow-condensed",
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
    <html lang="da" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="bg-bg font-sans text-16 text-text antialiased">
        <ScreenNav />
        <main className="mx-auto flex w-full max-w-content flex-col gap-4 pt-[max(12px,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(var(--bottom-bar)+3rem)] pl-[max(0.75rem,env(safe-area-inset-left))] lg:max-w-wide lg:gap-6 lg:px-8 lg:pb-12">{children}</main>
      </body>
    </html>
  );
}
