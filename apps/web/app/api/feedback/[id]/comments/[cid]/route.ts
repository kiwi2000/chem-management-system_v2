import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

/**
 * DELETE /api/feedback/[id]/comments/[cid] — 返信を消す（論理削除）。
 * 書いた本人か管理者だけ。返信は直せないので、書き損じはこれで消して書き直す
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id, cid } = await params;
  const m = await getServerMessages();

  const existing = await prisma.feedbackComment.findFirst({
    where: { id: cid, feedbackId: id, deletedAt: null },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  if (existing.createdBy !== actor.user.id && !actor.has("ADMIN")) {
    return jsonError(403, "forbidden", m.errors.forbidden);
  }

  await prisma.feedbackComment.update({ where: { id: cid }, data: { deletedAt: new Date() } });

  await writeAudit({
    entity: "feedback_comments",
    entityId: cid,
    action: "delete",
    actorId: actor.user.id,
    diff: { feedbackId: id },
  });
  return Response.json({ ok: true });
}
