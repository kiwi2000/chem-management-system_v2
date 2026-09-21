import { normalizeCode, prtrSiteSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission, requirePrtrScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_SITE_INCLUDE, toPrtrSiteDto } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/prtr/sites/[id] — 詳細。担当の範囲の外は 404 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const denied = await requirePrtrScope(actor, { siteId: id });
  if (denied) return denied;

  const s = await prisma.prtrSite.findFirst({
    where: { id, deletedAt: null },
    include: PRTR_SITE_INCLUDE,
  });
  if (!s) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item: toPrtrSiteDto(s) });
}

/** PUT /api/prtr/sites/[id] — 変更（PRTR 管理者。グループの付け替えは見える範囲を変えるので管理者だけ） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrSite.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrSiteSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  if (codeNormalized !== existing.codeNormalized) {
    if (await prisma.prtrSite.findFirst({ where: { codeNormalized } })) {
      return jsonError(409, "duplicate", m.prtr.sites.duplicateCode(v.code));
    }
  }
  if (!(await prisma.prtrGroup.findFirst({ where: { id: v.groupId, deletedAt: null } }))) {
    return jsonError(400, "validation_error", m.prtr.sites.groupMissing);
  }

  await prisma.prtrSite.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      groupId: v.groupId,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder ?? existing.displayOrder,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });
  await writeAudit({
    entity: "prtr_sites",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa, groupId: v.groupId },
  });
  return Response.json({ id });
}

/** DELETE /api/prtr/sites/[id] — 論理削除（PRTR 管理者）。担当している人がいれば断る */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrSite.findFirst({
    where: { id, deletedAt: null },
    include: PRTR_SITE_INCLUDE,
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  if (existing._count.scopes > 0) {
    return jsonError(409, "in_use", m.prtr.sites.inUseUsers(existing._count.scopes));
  }

  await prisma.prtrSite.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });
  await writeAudit({
    entity: "prtr_sites",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ id });
}
