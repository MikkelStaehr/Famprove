import { TabShell } from "@/components/TabShell";

/**
 * The three tabs mounted at once (docs/decisions/tab-shell.md §1): each slot renders its page at its
 * own URL, or its default when the URL is another tab's. TabShell stacks them and owns the swipe.
 */
export default function TabsLayout({
  train,
  load,
  analyse,
}: {
  readonly children: React.ReactNode;
  readonly train: React.ReactNode;
  readonly load: React.ReactNode;
  readonly analyse: React.ReactNode;
}) {
  return <TabShell pages={[train, load, analyse]} />;
}
