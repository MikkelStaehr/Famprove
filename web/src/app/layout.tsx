import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";

import { ScreenNav } from "@/components/ScreenNav";

import "./globals.css";

export const metadata: Metadata = {
  title: "Training load",
  description: "Daily fitness, fatigue and form from cycling and strength training.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
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
 * The nav sits outside the pages, so it also shows while a page loads or fails. Not sticky, and
 * absent on /fokus (ScreenNav renders nothing there). Its header ends with 4px, so the page's
 * title is 16px under the nav and Fokus's top bar 12px from the top.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="da" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="bg-bg font-sans text-16 text-text antialiased">
        <ScreenNav />
        <main className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 pt-3 pb-12">{children}</main>
      </body>
    </html>
  );
}
