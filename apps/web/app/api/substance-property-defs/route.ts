import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { toPropertyDefDto } from "@/lib/property-def-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/substance-property-defs — 項目定義の一覧。
 * 物質の閲覧・編集画面が使うので、閲覧権限で読める（作成・変更は /api/admin 側）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;

  // 物質の編集画面では、使わなくなった項目は出さない
  const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "true";

  const items = await prisma.substancePropertyDef.findMany({
    where: includeInactive ? {} : { activeFlag: true },
    orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
    include: { _count: { select: { values: true } } },
  });
  return Response.json({ items: items.map(toPropertyDefDto) });
}
