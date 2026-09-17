import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { orgItemLabels } from "@/lib/organisation-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/doc-fields — テンプレートで選べる、会社の自由項目の名前。
 *
 * 値は返さない。**名前だけ**あればテンプレートは組める。
 * 実際の値は帳票を作るときにサーバーで入れる（出した人の会社のもの）。
 */
export async function GET() {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  /*
    規制区分の名前。表のブロックで「出す規制区分」を選ぶため（2026-09-17 指示）。
    法規制の画面の権限が無くても名前は選べてよい（判定の中身ではない）
  */
  const categories = await prisma.regulationCategory.findMany({
    where: { deletedAt: null, law: { deletedAt: null } },
    orderBy: [{ law: { displayOrder: "asc" } }, { displayOrder: "asc" }],
    select: {
      id: true,
      lawId: true,
      nameOriginal: true,
      nameJa: true,
      nameEn: true,
      law: { select: { nameOriginal: true, nameJa: true, nameEn: true } },
    },
  });
  return Response.json({ orgItems: await orgItemLabels(), categories });
}
