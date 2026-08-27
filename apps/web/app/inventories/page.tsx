import { ForbiddenNotice } from "@/components/forbidden-notice";
import { InventorySection } from "@/components/inventory-section";
import { getActor } from "@/lib/authz";

/** インベントリ。参照は REGULATION_VIEW、編集は各APIで REGULATION_EDIT を見る */
export default async function InventoriesPage() {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  return <InventorySection />;
}
