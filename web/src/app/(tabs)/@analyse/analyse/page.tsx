import type { Metadata } from "next";

import { AnalyseTab } from "@/components/tabs/AnalyseTab";

export const metadata: Metadata = { title: "Analyse" };

export default function Page() {
  return <AnalyseTab section="cykel" />;
}
