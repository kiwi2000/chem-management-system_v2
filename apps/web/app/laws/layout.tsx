import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** 法規制マスタ。参照は REGULATION_VIEW、編集は各APIで REGULATION_EDIT を見る */
export default async function LawsLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
