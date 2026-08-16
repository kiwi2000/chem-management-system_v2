import type { ReactNode } from "react";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/**
 * お知らせの画面は投稿・編集のためのもの。読むだけならホームで足りるので、
 * 投稿できる人にだけ見せる（閲覧のための権限は設けていない）。
 * API 側でも書き込みは必ず権限を確認する。
 */
export default async function NewsLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor?.has("NEWS_POST")) return <ForbiddenNotice />;
  return <>{children}</>;
}
