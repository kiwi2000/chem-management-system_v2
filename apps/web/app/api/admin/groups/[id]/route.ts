import { groupSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { GROUP_COUNT_SELECT } from "@/lib/group-service";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/admin/groups/[id]
 * 用途（お知らせ / 組織）は、割り当て済みの人がいる間は変更できない。
 * 変えると所属の意味が変わってしまうため、据え置いて結果を返す。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.group.findFirst({
    where: { id, deletedAt: null },
    include: GROUP_COUNT_SELECT,
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = groupSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const inUse = existing._count.newsMembers + existing._count.news > 0;
  const kind = inUse && v.kind !== existing.kind ? existing.kind : v.kind;

  await prisma.group.update({
    where: { id },
    data: {
      kind,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      activeFlag: v.activeFlag,
    },
  });

  await writeAudit({
    entity: "groups",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { kind, nameJa: v.nameJa, activeFlag: v.activeFlag },
  });
  return Response.json({ ok: true, kindLocked: kind !== v.kind });
}

/**
 * DELETE — 使用中なら消さない。
 * 所属を勝手に外すと、誰がどこに居たか分からなくなるため、先に外してもらう。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.group.findFirst({
    where: { id, deletedAt: null },
    include: GROUP_COUNT_SELECT,
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  if (existing._count.newsMembers + existing._count.news > 0) {
    return jsonError(409, "group_in_use", m.groups.inUse);
  }

  await prisma.group.update({ where: { id }, data: { deletedAt: new Date() } });

  await writeAudit({
    entity: "groups",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { nameJa: existing.nameJa },
  });
  return Response.json({ ok: true });
}
