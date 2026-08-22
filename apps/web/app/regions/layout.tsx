import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** 地域は法規制マスタの一部なので、法規制と同じ権限で扱う */
export default async function RegionsLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
