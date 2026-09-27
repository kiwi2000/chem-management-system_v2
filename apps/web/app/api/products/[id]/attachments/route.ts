import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import {
  ATTACHMENT_SELECT,
  attachmentVisibility,
  inspectAttachment,
  toAttachmentDtos,
  visibleProduct,
} from "@/lib/attachment-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canEditProduct } from "@/lib/product-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/attachments — 添付ファイルの一覧（中身は載せない）。
 * 見られるのは製品を見られる人。「組成を見られる人だけ」のものは COMPOSITION_VIEW が無いと出さない
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await visibleProduct(actor, id);
  if (!product) return jsonError(404, "not_found", m.errors.notFound);

  const rows = await prisma.productAttachment.findMany({
    where: { productId: id, ...attachmentVisibility(actor, product) },
    orderBy: { createdAt: "asc" },
    select: ATTACHMENT_SELECT,
  });
  return Response.json({ items: await toAttachmentDtos(rows) });
}

/**
 * POST /api/products/[id]/attachments — 追加（multipart の `files`。複数可）。
 * 製品を編集できる人だけ。1 ファイルずつ確かめて入れ、断ったものは理由を返す
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await visibleProduct(actor, id);
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditProduct(actor, product)) return jsonError(403, "forbidden", m.errors.forbidden);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return jsonError(400, "no_files", m.errors.validation);

  // 上限とマクロの扱いはシステム設定で決める（2026-09-27 指示）
  const settings = await getAppSettings();
  const added: string[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const f of files) {
    const name = f.name.slice(0, 255);
    const buf = Buffer.from(await f.arrayBuffer());
    const checked = await inspectAttachment(name, buf, settings);
    if (!checked.ok) {
      const r = m.attachments.rejects[checked.reason];
      rejected.push({ name, reason: typeof r === "function" ? r(settings.attachmentMaxMb) : r });
      continue;
    }
    const row = await prisma.productAttachment.create({
      data: {
        productId: id,
        fileName: name,
        mime: checked.mime,
        size: buf.length,
        data: new Uint8Array(buf),
        createdBy: actor.user.id,
        updatedBy: actor.user.id,
      },
      select: { id: true },
    });
    added.push(row.id);
    await writeAudit({
      entity: "product_attachment",
      entityId: row.id,
      action: "create",
      actorId: actor.user.id,
      diff: { productId: id, productCode: product.code, fileName: name, size: buf.length },
    });
  }

  const rows = await prisma.productAttachment.findMany({
    where: { productId: id, ...attachmentVisibility(actor, product) },
    orderBy: { createdAt: "asc" },
    select: ATTACHMENT_SELECT,
  });
  return Response.json(
    { items: await toAttachmentDtos(rows), added: added.length, rejected },
    { status: added.length > 0 ? 201 : 400 },
  );
}
