import { normalizeCas, statutoryCasLinkSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/statutory-cas-links/[id] — 直す。バージョンと法文物質名は動かさない */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.statutoryCasLink.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = statutoryCasLinkSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const source = await prisma.source.findFirst({ where: { id: v.sourceId, deletedAt: null } });
  if (!source) return jsonError(404, "not_found", m.errors.notFound);

  const casNormalized = normalizeCas(v.casNumber);
  const dup = await prisma.statutoryCasLink.findFirst({
    where: {
      versionId: existing.versionId,
      statutorySubstanceId: existing.statutorySubstanceId,
      casNormalized,
      sourceId: v.sourceId,
      id: { not: id },
    },
  });
  if (dup) return jsonError(409, "duplicate", m.casLinks.duplicate);

  await prisma.statutoryCasLink.update({
    where: { id },
    data: {
      sourceId: v.sourceId,
      casNumber: v.casNumber,
      casNormalized,
      excluded: v.excluded,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "statutory_cas_links",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      casNumber: { from: existing.casNumber, to: v.casNumber },
      excluded: { from: existing.excluded, to: v.excluded },
    },
  });

  return Response.json({ ok: true });
}

/** DELETE /api/statutory-cas-links/[id] — 消す。取り込み直しで作り直せるので物理削除 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.statutoryCasLink.findUnique({
    where: { id },
    include: { source: { select: { code: true } } },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.statutoryCasLink.delete({ where: { id } });

  await writeAudit({
    entity: "statutory_cas_links",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { casNumber: existing.casNumber, sourceCode: existing.source.code },
  });

  return Response.json({ ok: true });
}
