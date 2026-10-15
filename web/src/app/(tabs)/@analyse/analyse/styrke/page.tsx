import type { Metadata } from "next";

import { AnalyseTab } from "@/components/tabs/AnalyseTab";

export const metadata: Metadata = { title: "Analyse · Styrke" };

export default function Page() {
  return <AnalyseTab section="styrke" />;
}
