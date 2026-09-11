import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { SubstancesLists } from "./substances-lists";

/**
 * 物質マスタの一覧。
 * 承認の要否はシステム設定にあるので、ここで読んで画面へ渡す
 * （設定APIは管理者専用なので、画面から直接は読めない）。
 */
export default async function SubstancesPage() {
  const settings = await getAppSettings();
  // ランクの絞り込みの選択肢。設定で決めた段の名前を、段の順に渡す
  const bands = await prisma.substanceRankBand.findMany({
    where: { deletedAt: null },
    orderBy: { displayOrder: "asc" },
    select: { label: true },
  });
  return (
    <SubstancesLists
      approvalRequired={settings.substanceApprovalRequired}
      rankOptions={[...new Set(bands.map((b) => b.label))]}
    />
  );
}
