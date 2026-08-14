import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** 金属換算係数は判定のパラメータなので、法規制と同じ権限で扱う */
export default async function MetalFactorsLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
