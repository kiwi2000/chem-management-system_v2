import { prtrMinisterSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { nextDisplayOrder, toPrtrMinisterDto } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

/** GET /api/prtr/ministers — 主務大臣の一覧（S22-1）。件数が知れているので絞り込みは持たない */
export async function GET() {
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN");
  if (actor instanceof Response) return actor;

  const items = await prisma.prtrMinister.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { industries: { where: { deletedAt: null } } } } },
  });
  return Response.json({
    items: items.map(toPrtrMinisterDto),
    total: items.length,
    page: 1,
    pageSize: items.length,
  });
}

/** POST /api/prtr/ministers — 追加（PRTR 管理者） */
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
  const parsed = prtrMinisterSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const created = await prisma.prtrMinister.create({
    data: {
      name: v.name,
      active: v.active ?? true,
      displayOrder: await nextDisplayOrder("prtrMinister"),
    },
  });
  await writeAudit({
    entity: "prtr_ministers",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { name: v.name },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
