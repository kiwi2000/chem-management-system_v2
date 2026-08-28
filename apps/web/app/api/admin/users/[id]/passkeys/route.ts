import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/users/[id]/passkeys — 管理者による、その人のパスキー全消し。
 *
 * 端末を失くした人の救済のためにある。認証アプリの強制解除と同じ役目。
 * 消したら、その人のセッションは全部切る（乗っ取られていた場合に確実に追い出すため）。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return jsonError(404, "not_found", m.errors.notFound);

  const removed = await prisma.passkey.deleteMany({ where: { userId: id } });
  if (removed.count === 0) return Response.json({ ok: true, count: 0 });

  await revokeAllSessions(id);
  await writeAudit({
    entity: "users",
    entityId: id,
    action: "passkey_remove",
    actorId: actor.user.id,
    diff: { resetBy: actor.user.email, email: user.email, count: removed.count },
  });
  return Response.json({ ok: true, count: removed.count });
}
