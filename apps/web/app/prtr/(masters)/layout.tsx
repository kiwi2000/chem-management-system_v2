import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * マスタ（グループ・工場・業種・主務大臣・事業者）は PRTR 管理者だけ。
 * 入力・集計の画面は /prtr 直下に置き、こちらのガードは通らない
 */
export default async function PrtrMastersLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("PRTR_ADMIN")) return <ForbiddenNotice />;
  return <>{children}</>;
}
