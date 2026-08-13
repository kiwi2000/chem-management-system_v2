import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * 物質の画面は SUBSTANCE_VIEW が要る。
 * API 側でも必ず requirePermission を通すので、ここは「見せない」ためのガード。
 */
export default async function SubstancesLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("SUBSTANCE_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
