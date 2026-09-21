import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * /prtr 配下は「PRTR の届出データを入力できる」が要る。
 * API 側でも必ず requirePermission と所属の確認を通すので、ここは「見せない」ためのガード
 */
export default async function PrtrLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("PRTR_ENTRY")) return <ForbiddenNotice />;
  return <>{children}</>;
}
