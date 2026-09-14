import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * /import-export 配下は「データの持ち込み」か「持ち出し」のどちらかの権限がある人だけ。
 * API 側でも requirePermission を通すので、ここは「見せない」ためのガード
 */
export default async function ImportExportLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor || !(actor.has("DATA_IMPORT") || actor.has("DATA_EXPORT"))) return <ForbiddenNotice />;
  return <>{children}</>;
}
