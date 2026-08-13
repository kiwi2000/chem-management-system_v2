import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * /admin 配下はシステム管理者だけ。
 * API 側でも必ず requireAdmin を通すので、ここは「見せない」ためのガード。
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("ADMIN")) return <ForbiddenNotice />;
  return <>{children}</>;
}
