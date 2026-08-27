import { ForbiddenNotice } from "@/components/forbidden-notice";
import { InventoryRowsSection } from "@/components/inventory-rows-section";
import { getActor } from "@/lib/authz";

/** インベントリの該当物質。参照は REGULATION_VIEW、編集は各APIで REGULATION_EDIT を見る */
export default async function InventoryRowsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  const { id } = await params;
  return <InventoryRowsSection inventoryId={id} />;
}
