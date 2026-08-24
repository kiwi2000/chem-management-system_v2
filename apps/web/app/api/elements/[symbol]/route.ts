import { elementSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ symbol: string }> };

/**
 * PUT /api/elements/[symbol] — 書き換え。
 * 元素記号はキーなので変えられない（換算係数がこの記号で結び付いているため）。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { symbol } = await params;
  const m = await getServerMessages();

  const existing = await prisma.element.findUnique({ where: { symbol } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = elementSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  if (v.symbol !== symbol) return jsonError(409, "immutable", m.elements.duplicateSymbol(v.symbol));

  if (v.atomicNumber !== existing.atomicNumber) {
    const clash = await prisma.element.findUnique({ where: { atomicNumber: v.atomicNumber } });
    if (clash) return jsonError(409, "duplicate", m.elements.duplicateNumber(v.atomicNumber));
  }

  await prisma.element.update({
    where: { symbol },
    data: {
      atomicNumber: v.atomicNumber,
      nameJa: v.nameJa,
      nameEn: v.nameEn,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "elements",
    entityId: symbol,
    action: "update",
    actorId: actor.user.id,
    diff: { symbol, nameJa: v.nameJa },
  });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/elements/[symbol] — 論理削除。
 * 換算係数から使われているものは消せない。引けなくなると寄与が0になり、
 * 「非該当」と黙って出てしまうため。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { symbol } = await params;
  const m = await getServerMessages();

  const existing = await prisma.element.findUnique({ where: { symbol } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const used = await prisma.metalConversionFactor.count({
    where: { metalElement: symbol, deletedAt: null },
  });
  if (used > 0) return jsonError(409, "referenced", m.elements.inUse(used));

  await prisma.element.update({
    where: { symbol },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });

  await writeAudit({
    entity: "elements",
    entityId: symbol,
    action: "delete",
    actorId: actor.user.id,
    diff: { symbol, nameJa: existing.nameJa },
  });
  return Response.json({ ok: true });
}
