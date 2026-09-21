import { prtrIndustrySchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { nextDisplayOrder, toPrtrIndustryDto } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/prtr/industries — 業種の一覧（S22-1）。
 * 件数が知れているので絞り込み・ページ送りは持たない。届出データを作る人も引くので PRTR の権限があればよい
 */
export async function GET() {
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN");
  if (actor instanceof Response) return actor;

  const items = await prisma.prtrIndustry.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    include: { defaultMinister: { select: { name: true } } },
  });
  return Response.json({
    items: items.map(toPrtrIndustryDto),
    total: items.length,
    page: 1,
    pageSize: items.length,
  });
}

/** POST /api/prtr/industries — 追加（PRTR 管理者） */
export async function POST(req: Request) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrIndustrySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  if (await prisma.prtrIndustry.findFirst({ where: { code: v.code, deletedAt: null } })) {
    return jsonError(409, "duplicate", m.prtr.industries.duplicateCode(v.code));
  }
  if (
    v.defaultMinisterId &&
    !(await prisma.prtrMinister.findFirst({ where: { id: v.defaultMinisterId, deletedAt: null } }))
  ) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const created = await prisma.prtrIndustry.create({
    data: {
      code: v.code,
      name: v.name,
      defaultMinisterId: v.defaultMinisterId ?? null,
      active: v.active ?? true,
      displayOrder: await nextDisplayOrder("prtrIndustry"),
    },
  });
  await writeAudit({
    entity: "prtr_industries",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, name: v.name },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
