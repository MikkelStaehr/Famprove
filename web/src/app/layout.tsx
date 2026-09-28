import type { Metadata, Viewport } from "next";

import { ScreenNav } from "@/components/ScreenNav";
import { TickProvider } from "@/components/TickProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Training load",
  description: "Daily fitness, fatigue and form from cycling and strength training.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
};

/** The nav sits outside the pages, so it also shows while a page loads or fails. Not sticky. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="bg-bg font-sans text-16 text-text antialiased">
        <header className="mx-auto w-full max-w-content px-4 pt-2">
          <ScreenNav />
        </header>
        <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-6 sm:py-8">
          <TickProvider>{children}</TickProvider>
        </main>
      </body>
    </html>
  );
}
