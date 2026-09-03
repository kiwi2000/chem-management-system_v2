import { expandPermissions, userUpdateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  countActiveAdmins,
  resolveGroups,
  setOrganisations,
  setPermissions,
  toUserSummary,
  USER_INCLUDE,
} from "@/lib/user-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/users/[id] */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: USER_INCLUDE,
  });
  if (!user) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item: toUserSummary(user) });
}

/** PUT /api/admin/users/[id] — 表示名・権限・有効/無効の更新 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = userUpdateSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { displayName, permissions, activeFlag, newsGroupId, organisationIds } = parsed.data;
  const next = expandPermissions(permissions);

  const groups = await resolveGroups(newsGroupId ?? null, next, organisationIds ?? []);
  if (groups instanceof Response) return groups;

  // 締め出し防止: 自分自身の管理権限は外せない。管理者が0人になる操作もできない
  const losesAdmin = !next.includes("ADMIN") || !activeFlag;
  if (losesAdmin) {
    if (id === actor.user.id) {
      return jsonError(409, "cannot_remove_own_admin", m.errors.cannotRemoveOwnAdmin);
    }
    if ((await countActiveAdmins(id)) === 0) {
      return jsonError(409, "cannot_remove_last_admin", m.errors.cannotRemoveLastAdmin);
    }
  }

  await prisma.user.update({
    where: { id },
    data: { displayName: displayName ?? null, activeFlag, newsGroupId: groups.newsGroupId },
  });
  await setOrganisations(id, groups.organisationIds);
  const granted = await setPermissions(id, next, actor.user.id);

  // 無効化・権限縮小をその場で効かせるため、対象ユーザーのセッションを切る
  await revokeAllSessions(id);

  await writeAudit({
    entity: "users",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { displayName, activeFlag, permissions: granted },
  });
  return Response.json({ ok: true, permissions: granted });
}

/** DELETE /api/admin/users/[id] — 論理削除 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return jsonError(404, "not_found", m.errors.notFound);
  if (id === actor.user.id) {
    return jsonError(409, "cannot_delete_self", m.errors.cannotDeleteSelf);
  }
  if ((await countActiveAdmins(id)) === 0) {
    return jsonError(409, "cannot_remove_last_admin", m.errors.cannotRemoveLastAdmin);
  }

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), activeFlag: false },
  });
  await revokeAllSessions(id);

  await writeAudit({
    entity: "users",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { email: user.email },
  });
  return Response.json({ ok: true });
}
