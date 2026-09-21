import { requireAnyPermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { toPrtrRegistrantDto } from "@/lib/prtr-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/prtr/registrants — 事業者（届出者）の一覧（S22-1）。
 *
 * 組織マスタの「会社」全部を、届出者の項目の有無に関わらず返す（まだ入れていない会社も選べるように）。
 * 既定の事業者はシステム設定で決まるが、**設定の API を緩めず**、ここで既定の印だけ付けて返す
 * （届出データを作る人は管理者ではない）
 */
export async function GET() {
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN");
  if (actor instanceof Response) return actor;

  const [companies, settings] = await Promise.all([
    prisma.organisation.findMany({
      where: { kind: "COMPANY", deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, nameJa: true, nameEn: true, prtrRegistrant: true },
    }),
    getAppSettings(),
  ]);
  const items = companies.map((c) =>
    toPrtrRegistrantDto(c, settings.prtrDefaultRegistrantOrganisationId),
  );
  return Response.json({ items, total: items.length, page: 1, pageSize: items.length });
}
