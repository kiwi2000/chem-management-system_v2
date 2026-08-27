import { documentTemplateSchema, normalizeCode, parseDocumentContent } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/doc-templates/[id] — 1件。編集画面が開くときに読む */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: DOC_TEMPLATE_SELECT,
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  return Response.json(toDocTemplateDto(row));
}

/**
 * PATCH /api/doc-templates/[id] — 入れものか、中身のどちらかを直す。
 *
 * **中身だけを送ってくることがある。**ブロックを並べ替えるたびに
 * 名前や対象まで送らせると、編集画面が入れものの状態も抱えることになる。
 * `content` があればそれだけを、無ければ入れものを直す。
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const actor = await requirePermission("ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const current = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!current) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }

  // --- 中身だけを直す ---------------------------------------------------------
  if (body !== null && typeof body === "object" && "content" in body) {
    const content = parseDocumentContent((body as { content: unknown }).content);
    if (!content) return jsonError(400, "validation_error", m.errors.validation);
    const row = await prisma.documentTemplate.update({
      where: { id },
      data: { content: content as unknown as object, updatedBy: actor.user.id },
      select: DOC_TEMPLATE_SELECT,
    });
    await writeAudit({
      entity: "document_templates",
      entityId: id,
      action: "update",
      actorId: actor.user.id,
      diff: { blocks: content.blocks.length },
    });
    return Response.json(toDocTemplateDto(row));
  }

  // --- 入れものを直す ---------------------------------------------------------
  const parsed = documentTemplateSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error);
  }
  const input = parsed.data;
  const codeNormalized = normalizeCode(input.code);
  const dup = await prisma.documentTemplate.findUnique({ where: { codeNormalized } });
  if (dup && dup.id !== id) {
    return jsonError(409, "duplicate_code", m.docTemplates.duplicateCode(input.code));
  }

  const row = await prisma.documentTemplate.update({
    where: { id },
    data: {
      code: input.code,
      codeNormalized,
      nameJa: input.nameJa,
      nameEn: input.nameEn ?? null,
      target: input.target,
      locale: input.locale,
      active: input.active,
      note: input.note ?? null,
      updatedBy: actor.user.id,
    },
    select: DOC_TEMPLATE_SELECT,
  });
  await writeAudit({
    entity: "document_templates",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: row.code, target: row.target },
  });
  return Response.json(toDocTemplateDto(row));
}

/**
 * DELETE /api/doc-templates/[id]。
 * **記録が残っているものも消せる。**生成の記録はテンプレートを指すが、
 * 消すのは印を付けるだけなので、記録から名前をたどれる状態は保たれる
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.documentTemplate.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });
  await writeAudit({
    entity: "document_templates",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: row.code },
  });
  return Response.json({ ok: true });
}
