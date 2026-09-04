import { writeAudit } from "@/lib/audit";
import { currentSessionId, endSessionById } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/sessions/[id] — その利用者をログアウトさせる（セッションを終わらせる）。
 *
 * 行は消さず「管理者が切った」印を付ける。相手のログイン画面には
 * 「管理者によってログアウトされました」と出る。
 * **自分のセッションは切れない**（切ると自分が追い出され、戻る口が無くなる）
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  if (id === (await currentSessionId())) {
    return jsonError(409, "own_session", m.sessions.cannotEndOwn);
  }
  const session = await prisma.session.findFirst({
    where: { id, endedAt: null },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });
  if (!session) return jsonError(404, "not_found", m.errors.notFound);

  await endSessionById(id, "admin");
  await writeAudit({
    entity: "sessions",
    entityId: id,
    action: "logout",
    actorId: actor.user.id,
    diff: { userId: session.userId, email: session.user.email, by: "admin" },
  });
  return Response.json({ ok: true });
}
