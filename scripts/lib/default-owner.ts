import type { PrismaClient } from "@prisma/client";

/**
 * スクリプトが作る製品・物質の所属先（S31）。
 * 移行で作る「全体」（コード ALL）があればそれ、無ければシステム管理グループ以外のいちばん前のコード。
 * 管理グループが 1 つも無ければ止める（所属先の無いデータは作れない）
 */
export async function defaultOwnerGroupId(prisma: PrismaClient): Promise<string> {
  const all = await prisma.permissionGroup.findUnique({
    where: { code: "ALL" },
    select: { id: true },
  });
  if (all) return all.id;
  const first = await prisma.permissionGroup.findFirst({
    where: { isSystemAdmin: false },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  if (!first)
    throw new Error(
      "データを管理させる管理グループがありません（画面の「管理グループ」で作ってください）",
    );
  return first.id;
}
