import type { Messages } from "@chem/shared";
import { jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { visibilityWhere } from "@/lib/product-service";

/**
 * 製品コードの重なり。重なれば 409、無ければ null。
 * 見えないものと重なるときは理由を言わない（S31 仕様 7 章。見えないものの存在を知らせない）。
 * 作る前・直す前と、同時の保存で一意の決まりに当たったとき（lib/unique-violation.ts）の両方で使う
 */
export async function productCodeClash(
  actor: Actor,
  m: Messages,
  code: { code: string; codeNormalized: string },
  selfId?: string,
): Promise<Response | null> {
  const clash = await prisma.product.findUnique({
    where: { codeNormalized: code.codeNormalized },
    select: { id: true },
  });
  if (!clash || clash.id === selfId) return null;
  const seen = await prisma.product.count({ where: { id: clash.id, ...visibilityWhere(actor) } });
  const text = seen ? m.errors.duplicateProductCode(code.code) : m.owner.codeUnavailable;
  return jsonError(409, "duplicate_code", text, { fieldErrors: { code: [text] } });
}
