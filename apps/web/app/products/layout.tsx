import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * 製品の画面は PRODUCT_VIEW が要る。
 * API 側でも必ず requirePermission を通すので、ここは「見せない」ためのガード。
 */
export default async function ProductsLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("PRODUCT_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
