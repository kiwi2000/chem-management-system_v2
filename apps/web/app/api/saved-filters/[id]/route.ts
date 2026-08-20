import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/saved-filters/[id]
 * 消せるのは作った本人と管理者だけ。共有された条件を他人が勝手に消せると困るため。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const m = await getServerMessages();
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const existing = await prisma.savedFilter.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  if (existing.ownerId !== actor.user.id && !actor.has("ADMIN")) {
    return jsonError(403, "forbidden", m.errors.forbidden);
  }

  await prisma.savedFilter.delete({ where: { id } });
  return Response.json({ ok: true });
}
