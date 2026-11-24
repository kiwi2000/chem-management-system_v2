import type { Messages, SubstanceInput } from "@chem/shared";
import { jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasDuplicateGazette, visibilityWhere } from "@/lib/substance-service";

/**
 * 物質の重なり。重なれば 409（官報番号の重なりはいまのまま 400）、無ければ null。
 *
 * - 物質コード: 見えないものと重なるときは理由を言わない（S31 仕様 7 章。見えないものの存在を知らせない）
 * - 官報番号: 同じ物質の中で同じ区分・番号を 2 つ入れていないか（一意の決まり substanceId × lawKind × number）
 *
 * 作る前・直す前と、同時の保存で一意の決まりに当たったとき（lib/unique-violation.ts）の両方で使う
 */
export async function substanceCodeClash(
  actor: Actor,
  m: Messages,
  input: SubstanceInput,
  code: { code: string; codeNormalized: string },
  selfId?: string,
): Promise<Response | null> {
  if (hasDuplicateGazette(input)) {
    return jsonError(400, "duplicate_gazette", m.errors.duplicateGazette);
  }
  const clash = await prisma.substance.findUnique({
    where: { codeNormalized: code.codeNormalized },
    select: { id: true },
  });
  if (!clash || clash.id === selfId) return null;
  const seen = await prisma.substance.count({ where: { id: clash.id, ...visibilityWhere(actor) } });
  const text = seen ? m.errors.duplicateCode(code.code) : m.owner.codeUnavailable;
  return jsonError(409, "duplicate_code", text, { fieldErrors: { code: [text] } });
}
