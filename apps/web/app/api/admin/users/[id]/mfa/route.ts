import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/users/[id]/mfa — 管理者による2要素認証の強制解除。
 *
 * 端末を失くした人の救済のためにある。これが無いと本人が自分の口座から出られなくなる。
 * 解除したら、その人のセッションは全部切る（乗っ取られていた場合に確実に追い出すため）。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.user.update({
    where: { id },
    data: { mfaMethod: "none", mfaSecret: null },
  });
  await revokeAllSessions(id);

  await writeAudit({
    entity: "users",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { mfaResetBy: actor.user.email, email: user.email },
  });
  return Response.json({ ok: true });
}
