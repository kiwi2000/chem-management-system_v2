import { permissionGroupSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import {
  groupCode,
  loadPermissionGroup,
  normalizeGroupPermissions,
  normalizeRows,
  replaceRowsAndPermissions,
} from "@/lib/permission-group-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/permission-groups/[id] — 詳細（表・別の権限・入っている人） */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const item = await loadPermissionGroup(id);
  if (!item) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item });
}

/**
 * PUT /api/admin/permission-groups/[id] — コード・名前・表・別の権限を直す。
 * **入っている人のセッションは切らない**（画面設計の決定 6。次に開く画面から新しい表で動く）。
 * システム管理グループは何も直せない（コードも名前も変えられず、表を持たない。仕様 9 章）
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const current = await prisma.permissionGroup.findUnique({
    where: { id },
    select: { id: true, isSystemAdmin: true },
  });
  if (!current) return jsonError(404, "not_found", m.errors.notFound);
  if (current.isSystemAdmin) {
    return jsonError(409, "system_admin_group", m.permGroups.systemAdminLocked);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = permissionGroupSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  const input = parsed.data;
  const code = groupCode(input.code);
  const clash = await prisma.permissionGroup.findFirst({
    where: { code, id: { not: id } },
    select: { id: true },
  });
  if (clash) {
    return jsonError(409, "duplicate_code", m.permGroups.duplicateCode, {
      fieldErrors: { code: [m.permGroups.duplicateCode] },
    });
  }
  const rows = await normalizeRows(input.rows);
  const permissions = normalizeGroupPermissions(input.permissions);

  const hit = await prisma.permissionGroup.updateMany({
    where: { id, ...stampWhere(lock) },
    data: { code, nameJa: input.nameJa, nameEn: input.nameEn ?? null, updatedBy: actor.user.id },
  });
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.permissionGroup.findUnique({
        where: { id },
        select: { updatedAt: true, updatedBy: true },
      }),
    );
  }
  await prisma.$transaction(replaceRowsAndPermissions(id, rows, permissions));
  await writeAudit({
    entity: "permission_groups",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code, nameJa: input.nameJa, rows: rows.length, permissions },
  });
  const after = await prisma.permissionGroup.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}

/**
 * DELETE /api/admin/permission-groups/[id] — 消す（仕様 5 章）。
 * 消せるのは、入っている人も所属するデータも無いものだけ。システム管理グループは消せない。
 * 消すと、ほかの表のその行と、組織の「最初に選ばれる管理グループ」からも自動で外れる（外部キーで消える）
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const g = await prisma.permissionGroup.findUnique({
    where: { id },
    select: {
      code: true,
      isSystemAdmin: true,
      _count: { select: { members: true, products: true, substances: true } },
    },
  });
  if (!g) return jsonError(404, "not_found", m.errors.notFound);
  if (g.isSystemAdmin) {
    return jsonError(409, "system_admin_group", m.permGroups.systemAdminLocked);
  }
  if (g._count.members > 0 || g._count.products > 0 || g._count.substances > 0) {
    return jsonError(409, "in_use", m.permGroups.inUse(g.code));
  }
  await prisma.permissionGroup.delete({ where: { id } });
  await writeAudit({
    entity: "permission_groups",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: g.code },
  });
  return Response.json({ ok: true });
}
