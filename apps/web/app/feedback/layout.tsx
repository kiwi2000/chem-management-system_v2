import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * /feedback 配下は「フィードバックを見られる」人だけ（既定はシステム管理者。2026-09-13 指示）。
 * API 側でも必ず権限を通すので、ここは「見せない」ためのガード
 */
export default async function FeedbackLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("FEEDBACK_VIEW")) return <ForbiddenNotice />;
  return <>{children}</>;
}
