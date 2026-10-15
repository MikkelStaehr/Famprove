import { LoadTab } from "@/components/tabs/LoadTab";

/** Belastning when the URL is another tab's: the latest week (no `?week=`). */
export default function Default() {
  return <LoadTab week={undefined} />;
}
