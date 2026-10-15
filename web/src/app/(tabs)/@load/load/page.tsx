import type { Metadata } from "next";

import { LoadTab } from "@/components/tabs/LoadTab";

export const metadata: Metadata = { title: "Belastning" };

export default async function Page({ searchParams }: PageProps<"/load">) {
  const { week } = await searchParams;
  return <LoadTab week={week} />;
}
