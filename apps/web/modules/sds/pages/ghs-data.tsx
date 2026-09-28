import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { ModulePageProps } from "../../types";
import { GhsDataTabs } from "../components/ghs-data-tabs";
import { LINK_LAYERS } from "../ghs-data-api";
import { sdsMessages } from "../messages";

/** /sds/ghs-data — 物質 × 採用した GHS 分類の一覧。自社判定の登録と、国ごとの出典の採用順 */
export async function SdsGhsDataPage({ locale }: ModulePageProps) {
  const t = sdsMessages(locale);
  const actor = await getActor();
  // 見るのは物質を見られる人。中身は API 側でも同じ権限で確かめる
  if (!actor?.has("SUBSTANCE_VIEW")) return null;
  // タブに出すのは、項目を取り込み済みの出典だけ（結び付きだけのデータ種は層の切り替えのほう）
  const sources = await prisma.sdsGhsSource.findMany({
    where: { entries: { some: {} } },
    orderBy: { sortOrder: "asc" },
    select: { code: true, nameJa: true, nameEn: true },
  });
  // 付け外しできる結び付きの層（結び付きを取り込み済みのデータ種だけ。結び付きは当てた出典側に付くので linked_by で見る）
  const linkLayers = (
    await prisma.sdsGhsKeyLink.findMany({
      where: { linkedBy: { in: LINK_LAYERS } },
      distinct: ["linkedBy"],
      select: { linkedBy: true },
    })
  ).map((l) => ({ code: l.linkedBy }));
  return (
    <div className="space-y-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{t.data.title}</h1>
      <GhsDataTabs
        locale={locale}
        canEdit={actor.has("SUBSTANCE_EDIT")}
        isAdmin={actor.has("ADMIN")}
        sources={sources.map((s) => ({
          code: s.code,
          name: locale === "ja" ? s.nameJa : s.nameEn,
        }))}
        linkLayers={linkLayers.map((s) => s.code)}
      />
    </div>
  );
}
