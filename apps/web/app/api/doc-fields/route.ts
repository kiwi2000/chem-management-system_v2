import { requirePermission } from "@/lib/authz";
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
  return Response.json({ orgItems: await orgItemLabels() });
}
