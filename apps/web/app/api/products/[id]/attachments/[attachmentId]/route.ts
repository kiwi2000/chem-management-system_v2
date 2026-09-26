import { attachmentUpdateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import {
  ATTACHMENT_SELECT,
  attachmentVisibility,
  toAttachmentDtos,
  visibleProduct,
} from "@/lib/attachment-service";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canEditProduct } from "@/lib/product-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

/** 編集できる人が見られる、その製品の添付を引く。無ければ null */
async function editable(id: string, attachmentId: string) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return { error: actor } as const;
  const m = await getServerMessages();
  const product = await visibleProduct(actor, id);
  if (!product) return { error: jsonError(404, "not_found", m.errors.notFound) } as const;
  if (!canEditProduct(actor, product)) {
    return { error: jsonError(403, "forbidden", m.errors.forbidden) } as const;
  }
  const row = await prisma.productAttachment.findFirst({
    where: { id: attachmentId, productId: id, ...attachmentVisibility(actor, product) },
    select: ATTACHMENT_SELECT,
  });
  if (!row) return { error: jsonError(404, "not_found", m.errors.notFound) } as const;
  return { actor, product, row, m } as const;
}

/** PATCH — 種類・備考・「組成を見られる人だけ」を直す */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, attachmentId } = await params;
  const got = await editable(id, attachmentId);
  if ("error" in got) return got.error;
  const { actor, product, row, m } = got;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = attachmentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const next = parsed.data;
  // 「組成を見られる人だけ」を外せるのは、組成を見られる人だけ（見えない人が外すと漏れる）
  if (next.compositionOnly !== undefined && !canViewComposition(actor, product)) {
    return jsonError(403, "forbidden", m.errors.forbidden);
  }

  const updated = await prisma.productAttachment.update({
    where: { id: row.id },
    data: {
      ...(next.kind !== undefined ? { kind: next.kind } : {}),
      ...(next.note !== undefined ? { note: next.note || null } : {}),
      ...(next.compositionOnly !== undefined ? { compositionOnly: next.compositionOnly } : {}),
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
    diff: { productId: id, productCode: product.code, fileName: row.fileName, size: row.size },
  });
  return Response.json({ ok: true });
}
