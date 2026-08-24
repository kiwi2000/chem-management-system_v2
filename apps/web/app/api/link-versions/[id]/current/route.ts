import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/link-versions/[id]/current — この版を現在版にする。
 *
 * 現在版はシステム全体で1件だけ。テーブル側にも「is_current が真の行は1件」という
 * 制約を張ってあるので、外してから立てる順で1つのまとまりとして書き換える。
 */
export async function POST(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const target = await prisma.linkSetVersion.findFirst({ where: { id, deletedAt: null } });
  if (!target) return jsonError(404, "not_found", m.errors.notFound);
  if (target.isCurrent && target.currentPinned) return Response.json({ ok: true });

  await prisma.$transaction([
    // 指定は1つだけ。前の指定と現在の印を両方とも下ろしてから立てる
    prisma.linkSetVersion.updateMany({
      where: { OR: [{ isCurrent: true }, { currentPinned: true }] },
      data: { isCurrent: false, currentPinned: false, updatedBy: actor.user.id },
    }),
    prisma.linkSetVersion.update({
      where: { id },
      data: { isCurrent: true, currentPinned: true, updatedBy: actor.user.id },
    }),
  ]);

  await writeAudit({
    entity: "link_set_versions",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { isCurrent: true, code: target.code },
  });
  return Response.json({ ok: true });
}
