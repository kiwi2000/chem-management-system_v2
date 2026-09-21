import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * /prtr 配下は PRTR の権限（工場担当・グループ担当・管理者のどれか）が要る。
 * API 側でも必ず requirePermission と担当の範囲を通すので、ここは「見せない」ためのガード
 */
export default async function PrtrLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("PRTR_SITE") && !actor?.has("PRTR_GROUP") && !actor?.has("PRTR_ADMIN")) {
    return <ForbiddenNotice />;
  }
  return <>{children}</>;
}
