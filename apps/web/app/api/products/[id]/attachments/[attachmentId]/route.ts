import { attachmentFieldsSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import {
  ATTACHMENT_SELECT,
  canEditAttachments,
  toAttachmentDtos,
  validationMessage,
  visibleProduct,
} from "@/lib/attachment-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

/** 足す・消す・直してよい人が見る、その製品の添付を引く */
async function editable(id: string, attachmentId: string) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return { error: actor } as const;
  const m = await getServerMessages();
  const product = await visibleProduct(actor, id);
  if (!product) return { error: jsonError(404, "not_found", m.errors.notFound) } as const;
  if (!canEditAttachments(actor, product)) {
    return { error: jsonError(403, "forbidden", m.errors.forbidden) } as const;
  }
  const row = await prisma.productAttachment.findFirst({
    where: { id: attachmentId, productId: id },
    select: ATTACHMENT_SELECT,
  });
  if (!row) return { error: jsonError(404, "not_found", m.errors.notFound) } as const;
  return { actor, product, row, m } as const;
}

/** PUT — 件名・種類・説明を直す（ファイルは差し替えない。消して足し直す） */
export async function PUT(req: Request, { params }: Ctx) {
  const { id, attachmentId } = await params;
  const got = await editable(id, attachmentId);
  if ("error" in got) return got.error;
  const { actor, row, m } = got;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = attachmentFieldsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "validation_error",
      validationMessage(parsed.error, m),
      parsed.error.flatten(),
    );
  }
  const next = parsed.data;
  // 種類は選択肢から。**いま付いている値はそのまま残してよい**（選択肢から消した値でも）
  const settings = await getAppSettings();
  if (next.kind !== row.kind && !settings.attachmentKinds.includes(next.kind)) {
    return jsonError(400, "validation_error", m.attachments.kindInvalid);
  }

  const updated = await prisma.productAttachment.update({
    where: { id: row.id },
    data: {
      title: next.title,
      kind: next.kind,
      description: next.description || null,
      updatedBy: actor.user.id,
    },
    select: ATTACHMENT_SELECT,
  });
  await writeAudit({
    entity: "product_attachment",
    entityId: row.id,
    action: "update",
    actorId: actor.user.id,
    diff: { productId: id, fileName: row.fileName, ...next },
  });
  const [dto] = await toAttachmentDtos([updated]);
  return Response.json(dto);
}

/** DELETE — 消す（元に戻せない） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, attachmentId } = await params;
  const got = await editable(id, attachmentId);
  if ("error" in got) return got.error;
  const { actor, product, row } = got;

  await prisma.productAttachment.delete({ where: { id: row.id } });
  await writeAudit({
    entity: "product_attachment",
    entityId: row.id,
    action: "delete",
    actorId: actor.user.id,
    diff: {
      productId: id,
      productCode: product.code,
      title: row.title,
      fileName: row.fileName,
      size: row.size,
    },
  });
  return Response.json({ ok: true });
}
