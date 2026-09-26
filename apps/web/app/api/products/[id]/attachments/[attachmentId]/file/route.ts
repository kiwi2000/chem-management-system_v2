import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { attachmentVisibility, visibleProduct } from "@/lib/attachment-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

/**
 * GET /api/products/[id]/attachments/[attachmentId]/file — 中身を落とす。
 * 一覧と同じ見せかたの決まりを通す。**誰がいつ落としたかを記録に残す**（持ち出しの記録）
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id, attachmentId } = await params;
  const m = await getServerMessages();

  const product = await visibleProduct(actor, id);
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  const row = await prisma.productAttachment.findFirst({
    where: { id: attachmentId, productId: id, ...attachmentVisibility(actor, product) },
    select: { id: true, fileName: true, mime: true, data: true },
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  await writeAudit({
    entity: "product_attachment",
    entityId: row.id,
    action: "export",
    actorId: actor.user.id,
    diff: { productId: id, productCode: product.code, fileName: row.fileName },
  });

  // 名前は 2 通りで渡す（日本語の名前が化けないように。帳票の Word・Excel と同じ）
  let ascii = "";
  for (const ch of row.fileName) {
    const c = ch.codePointAt(0) ?? 0;
    ascii += c >= 0x20 && c <= 0x7e && ch !== '"' && ch !== ";" && ch !== "\\" ? ch : "_";
  }
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.data.byteLength),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      "Cache-Control": "no-store",
      // 中身を形式どおりに扱わせる（HTML などに読み替えさせない）
      "X-Content-Type-Options": "nosniff",
    },
  });
}
