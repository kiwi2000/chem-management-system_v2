import { normalizeCode, prtrGroupSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission, requirePrtrScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_GROUP_INCLUDE, toPrtrGroupDto } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/prtr/groups/[id] — 詳細。担当の範囲の外は 404 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const denied = await requirePrtrScope(actor, { groupId: id });
  if (denied) return denied;

  const g = await prisma.prtrGroup.findFirst({
    where: { id, deletedAt: null },
    include: PRTR_GROUP_INCLUDE,
  });
  if (!g) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item: toPrtrGroupDto(g) });
}

/** PUT /api/prtr/groups/[id] — 変更（PRTR 管理者） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrGroup.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrGroupSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  if (codeNormalized !== existing.codeNormalized) {
    if (await prisma.prtrGroup.findFirst({ where: { codeNormalized } })) {
      return jsonError(409, "duplicate", m.prtr.groups.duplicateCode(v.code));
    }
  }

  await prisma.prtrGroup.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      nameJa: v.nameJa,
      nameKana: v.nameKana ?? null,
      nameEn: v.nameEn ?? null,
      zip: v.zip ?? null,
      prefecture: v.prefecture ?? null,
      city: v.city ?? null,
      town: v.town ?? null,
      prefectureKana: v.prefectureKana ?? null,
      cityKana: v.cityKana ?? null,
      townKana: v.townKana ?? null,
      employeeNum: v.employeeNum ?? null,
      displayOrder: v.displayOrder ?? existing.displayOrder,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });
  await writeAudit({
    entity: "prtr_groups",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id });
}

/**
 * DELETE /api/prtr/groups/[id] — 論理削除（PRTR 管理者）。
 * 工場が属している・担当している人がいるときは、件数を示して断る
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrGroup.findFirst({
    where: { id, deletedAt: null },
    include: PRTR_GROUP_INCLUDE,
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  if (existing._count.sites > 0) {
    return jsonError(409, "in_use", m.prtr.groups.inUseSites(existing._count.sites));
  }
  if (existing._count.scopes > 0) {
    return jsonError(409, "in_use", m.prtr.groups.inUseUsers(existing._count.scopes));
  }

  await prisma.prtrGroup.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });
  await writeAudit({
    entity: "prtr_groups",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ id });
}
