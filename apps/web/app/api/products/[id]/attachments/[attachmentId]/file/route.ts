import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { canViewAttachments, isPreviewable, visibleProduct } from "@/lib/attachment-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

/**
 * GET /api/products/[id]/attachments/[attachmentId]/file — 中身を渡す。
 *
 * - 既定はダウンロード（`attachment`）
 * - `?preview=1` は、ブラウザがそのまま見せられる形式（PDF・画像・テキスト）だけ、その場で開く（`inline`）。
 *   それ以外の形式にプレビューを頼まれたら、ダウンロードとして返す
 * - テキストは Shift_JIS でも読めるよう UTF-8 に直して返す（Windows で作った CSV に多い）
 *
 * 見られるのは製品が見えて組成を見られる人だけ。**誰がいつ見た・落としたかを記録に残す**
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id, attachmentId } = await params;
  const m = await getServerMessages();

  const product = await visibleProduct(actor, id);
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canViewAttachments(actor, product)) return jsonError(403, "forbidden", m.errors.forbidden);
  const row = await prisma.productAttachment.findFirst({
    where: { id: attachmentId, productId: id },
    select: { id: true, title: true, fileName: true, mime: true, data: true },
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  const preview = new URL(req.url).searchParams.get("preview") === "1" && isPreviewable(row.mime);
  await writeAudit({
    entity: "product_attachment",
    entityId: row.id,
    action: preview ? "view" : "export",
    actorId: actor.user.id,
    diff: { productId: id, productCode: product.code, title: row.title, fileName: row.fileName },
  });

  let body = new Uint8Array(row.data);
  let type = row.mime;
  if (preview && row.mime.startsWith("text/")) {
    body = new Uint8Array(Buffer.from(decodeText(Buffer.from(row.data)), "utf8"));
    // text/csv はブラウザによってはダウンロードになるので、見せるときは text/plain にする
    type = "text/plain; charset=utf-8";
  }

  // 名前は 2 通りで渡す（日本語の名前が化けないように）
  let ascii = "";
  for (const ch of row.fileName) {
    const c = ch.codePointAt(0) ?? 0;
    ascii += c >= 0x20 && c <= 0x7e && ch !== '"' && ch !== ";" && ch !== "\\" ? ch : "_";
  }
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      "Cache-Control": "no-store",
      /*
        中身を形式どおりに扱わせる（HTML などに読み替えさせない）。その場で開くのは PDF・画像・
        テキストだけなので、中で何かが動くことはない（sandbox の CSP は Chrome の PDF 表示を止めるので付けない）
      */
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** UTF-8 で読めなければ Shift_JIS として読む */
function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}
