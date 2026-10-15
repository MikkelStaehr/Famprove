"use client";

import { TabError } from "@/components/tabs/TabError";

export default function Error({ retry }: { readonly error: Error; readonly retry: () => void }) {
  return <TabError tab="Træning" retry={retry} />;
}
