import { documentTemplateSchema, normalizeCode, parseDocumentContent } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { inspectTemplateFile } from "@/lib/doc-fill";
import { STAMP_SELECT, parseEditStamp, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { orgItemLabels } from "@/lib/organisation-service";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/doc-templates/[id] — 1件。編集画面が開くときに読む */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: DOC_TEMPLATE_SELECT,
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const dto = toDocTemplateDto(row);

  /*
    預かったファイルは、**開くたびに札を数え直す。**
    保存しておくと、組織の項目が増えたときに「知らない札」の印だけが古くなる
  */
  if (row.kind !== "BLOCK") {
    const file = await prisma.documentTemplate.findUnique({
      where: { id },
      select: { fileData: true },
    });
    if (file?.fileData) {
      const orgItems = await orgItemLabels();
      const found = await inspectTemplateFile(
        Buffer.from(file.fileData),
        row.kind,
        row.target,
        orgItems,
      );
      if (found.ok) {
        dto.fileTags = found.tags;
        dto.fileUnknown = found.unknown;
      }
    }
  }
  return Response.json(dto);
}

/**
 * PATCH /api/doc-templates/[id] — 入れものか、中身のどちらかを直す。
 *
 * **中身だけを送ってくることがある。**ブロックを並べ替えるたびに
 * 名前や対象まで送らせると、編集画面が入れものの状態も抱えることになる。
 * `content` があればそれだけを、無ければ入れものを直す。
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
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
  // ほかの人が先に保存していないか（楽観的ロック。lib/edit-stamp.ts）。印が無ければ断る。
  // 中身だけ・入れものだけのどちらを直すときも、同じ 1 行の印で見る
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  /** 印が合う行だけを直す。当たらなければ null（ほかの人が先に保存している） */
  const updateIfFresh = async (data: Prisma.DocumentTemplateUpdateManyMutationInput) => {
    const hit = await prisma.documentTemplate.updateMany({
      where: { id, ...stampWhere(lock) },
      data,
    });
    if (hit.count === 0) return null;
    return prisma.documentTemplate.findUniqueOrThrow({
      where: { id },
      select: DOC_TEMPLATE_SELECT,
    });
  };
  const stale = async () =>
    staleFromRow(
      m,
      await prisma.documentTemplate.findUnique({ where: { id }, select: STAMP_SELECT }),
    );

  // --- 中身だけを直す ---------------------------------------------------------
  if (body !== null && typeof body === "object" && "content" in body) {
    const content = parseDocumentContent((body as { content: unknown }).content);
    if (!content) return jsonError(400, "validation_error", m.errors.validation);
    const row = await updateIfFresh({
      content: content as unknown as object,
      updatedBy: actor.user.id,
    });
    if (!row) return stale();
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

  const row = await updateIfFresh({
    code: input.code,
    codeNormalized,
    nameJa: input.nameJa,
    nameEn: input.nameEn ?? null,
    target: input.target,
    kind: input.kind,
    locale: input.locale,
    active: input.active,
    usesRecipient: input.usesRecipient,
    note: input.note ?? null,
    updatedBy: actor.user.id,
  });
  if (!row) return stale();
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
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
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
