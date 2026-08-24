import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** 外部データベース。参照は REGULATION_VIEW、編集は各APIで REGULATION_EDIT を見る */
export default async function ExternalDbLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
