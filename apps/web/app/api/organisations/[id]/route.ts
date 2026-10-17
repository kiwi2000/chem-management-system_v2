import { duplicateLabels, organisationSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, StaleError, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { ORG_INCLUDE, toOrganisationDto } from "@/lib/organisation-service";

export const dynamic = "force-dynamic";

/** GET /api/organisations/[id] — 1件。**見るのは誰でも** */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const m = await getServerMessages();

  const row = await prisma.organisation.findFirst({
    where: { id, deletedAt: null },
    include: ORG_INCLUDE,
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  return Response.json(toOrganisationDto(row));
}

/** PUT /api/organisations/[id] — 直す。項目はまるごと入れ替える */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("ORG_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = organisationSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  const dup = duplicateLabels(v.items);
  if (dup.length > 0) {
    return jsonError(400, "validation_error", m.validation.duplicateLabel(dup[0]!));
  }
  const current = await prisma.organisation.findFirst({ where: { id, deletedAt: null } });
  if (!current) return jsonError(404, "not_found", m.errors.notFound);
  if (
    v.code !== current.code &&
    (await prisma.organisation.findFirst({ where: { code: v.code, deletedAt: null } }))
  ) {
    return jsonError(409, "duplicate_code", m.organisations.duplicateCode(v.code));
  }

  /*
    項目は消してから入れ直す。**差分で当てない。**
    画面で消した行がサーバーに残ると、消したはずのものが帳票に出る
  */
  try {
    await prisma.$transaction(async (tx) => {
      // 門番。印が合う行だけを更新し、当たらなければ（ほかの人が先に保存していれば）やめる
      const gate = await tx.organisation.updateMany({
        where: { id, ...stampWhere(lock) },
        data: {
          code: v.code,
          nameJa: v.nameJa,
          nameEn: v.nameEn ?? null,
          displayOrder: v.displayOrder,
          activeFlag: v.activeFlag,
        },
      });
      if (gate.count === 0) throw new StaleError();
      await tx.organisationItem.deleteMany({ where: { organisationId: id } });
      await tx.organisationItem.createMany({
        data: v.items.map((x, i) => ({
          organisationId: id,
          label: x.label,
          value: x.value,
          displayOrder: i,
        })),
      });
    });
  } catch (err) {
    if (err instanceof StaleError) {
      // 組織は更新者を持たないので、時刻だけ添える
      return staleFromRow(
        m,
        await prisma.organisation.findUnique({ where: { id }, select: { updatedAt: true } }),
      );
    }
    throw err;
  }

  await writeAudit({
    entity: "organisations",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa, items: v.items.length },
  });
  const after = await prisma.organisation.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}

/**
 * DELETE /api/organisations/[id] — 消す（印だけ付ける）。
 * **人が属したままでは消せない。**帳票の差出人が黙って空になるため
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("ORG_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const m = await getServerMessages();

  const row = await prisma.organisation.findFirst({
    where: { id, deletedAt: null },
    include: { _count: { select: { members: true } } },
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  if (row._count.members > 0) {
    return jsonError(409, "in_use", m.organisations.inUse(row._count.members));
  }

  await prisma.organisation.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    entity: "organisations",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: row.code, nameJa: row.nameJa },
  });
  return Response.json({ ok: true });
}
