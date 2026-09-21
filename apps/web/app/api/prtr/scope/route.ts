import { prtrOrgsOf, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { PrtrScopeDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/prtr/scope — 届出データを入れられる所属（S22）。
 * 利用者が所属している組織（種別を問わず）。所属が無ければ空で、画面はその旨を出す
 */
export async function GET() {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const ids = await prtrOrgsOf(actor);
  const organisations = ids.length
    ? await prisma.organisation.findMany({
        where: { id: { in: ids }, deletedAt: null },
        orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
        select: { id: true, code: true, nameJa: true, nameEn: true },
      })
    : [];
  const body: PrtrScopeDto = { organisations };
  return Response.json(body);
}
