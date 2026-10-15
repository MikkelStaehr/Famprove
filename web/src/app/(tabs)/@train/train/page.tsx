import type { Metadata } from "next";

import { TrainTab } from "@/components/tabs/TrainTab";

export const metadata: Metadata = { title: "Træning" };

export default function Page() {
  return <TrainTab />;
}
