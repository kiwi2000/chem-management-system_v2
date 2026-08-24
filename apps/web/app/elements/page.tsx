import { ElementSection } from "@/components/element-section";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** 元素。参照は REGULATION_VIEW、編集は各APIで REGULATION_EDIT を見る */
export default async function ElementsPage() {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  return <ElementSection />;
}
