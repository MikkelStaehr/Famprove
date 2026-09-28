import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Training load",
  description: "Daily fitness, fatigue and form from cycling and strength training.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="bg-bg font-sans text-16 text-text antialiased">
        <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
