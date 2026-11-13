import { revokeAllSessions } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { countActiveAdmins } from "@/lib/user-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 管理グループの「入っている人」を、管理グループの画面から足す・外す（画面設計の決定 1）。
 * ユーザーの画面から直したのと同じ結果になる。表の保存とは別に、その場で確定する。
 * 外した人のセッションは切る（S4 の決まり 6。足した人も、新しい権限をすぐ効かせるため切る）
 */

/** POST — 人を足す。{ userIds: string[] } */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const group = await prisma.permissionGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) return jsonError(404, "not_found", m.errors.notFound);
  const body = (await req.json().catch(() => null)) as { userIds?: unknown } | null;
  const userIds = Array.isArray(body?.userIds)
    ? [...new Set(body.userIds.filter((v): v is string => typeof v === "string" && v !== ""))]
    : [];
  if (userIds.length === 0) return jsonError(400, "validation_error", m.errors.validation);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: { id: true },
  });
  if (users.length !== userIds.length) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  const r = await prisma.userPermissionGroup.createMany({
    data: userIds.map((userId) => ({
      userId,
      groupId: id,
      reason: "MANUAL" as const,
      grantedBy: actor.user.id,
    })),
    skipDuplicates: true,
  });
  for (const userId of userIds) await revokeAllSessions(userId);
  await writeAudit({
    entity: "permission_groups",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { userIds },
  });
  return Response.json({ ok: true, added: r.count });
}

/** DELETE ?userId= — 人を外す */
export async function DELETE(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  const group = await prisma.permissionGroup.findUnique({
    where: { id },
    select: { isSystemAdmin: true },
  });
  if (!group) return jsonError(404, "not_found", m.errors.notFound);
  const member = await prisma.userPermissionGroup.findUnique({
    where: { userId_groupId: { userId, groupId: id } },
    select: { userId: true },
  });
  if (!member) return jsonError(404, "not_found", m.errors.notFound);
  // 締め出し防止: 自分をシステム管理グループから外せない。最後の 1 人も外せない（仕様 9 章）
  if (group.isSystemAdmin) {
    if (userId === actor.user.id) {
      return jsonError(409, "cannot_remove_own_admin", m.errors.cannotRemoveOwnAdmin);
    }
    if ((await countActiveAdmins(userId)) === 0) {
      return jsonError(409, "cannot_remove_last_admin", m.errors.cannotRemoveLastAdmin);
    }
  }
  await prisma.userPermissionGroup.delete({
    where: { userId_groupId: { userId, groupId: id } },
  });
  await revokeAllSessions(userId);
  await writeAudit({
    entity: "permission_groups",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { userId },
  });
  return Response.json({ ok: true });
}
