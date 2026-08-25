import { prisma } from "@/lib/db";
import type { ProductJudgementDto } from "@/lib/types";

/**
 * 判定結果を、画面に出せる形に組み立てる。
 *
 * 法令名・区分名・物質名は判定の行に持っていない
 * （二重に持つと必ず食い違うため）。ここで引いて足す。
 */

/**
 * その製品の判定を、法令・区分の並び順で返す。
 *
 * `withHits` が false のときは根拠を伏せる。組成を見られない人に
 * 「何が何％入っているか」を渡すことになるため。
 */
export async function toJudgementDtos(
  productId: string,
  withHits: boolean,
): Promise<ProductJudgementDto[]> {
  const rows = await prisma.productJudgement.findMany({
    where: { productId },
    select: {
      categoryId: true,
      verdict: true,
      source: true,
      needsReview: true,
      reviewReasons: true,
      decidedBy: true,
      decidedAt: true,
      decidedNote: true,
      computedAt: true,
      hits: { select: { statutorySubstanceId: true, pct: true } },
      category: {
        select: {
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          displayOrder: true,
          law: {
            select: {
              code: true,
              nameJa: true,
              nameEn: true,
              nameOriginal: true,
              displayOrder: true,
            },
          },
        },
      },
    },
  });

  // 名前はまとめて引く。1件ずつ引くと、区分の数だけ問い合わせが増える
  const substanceIds = withHits
    ? [
        ...new Set(
          rows.flatMap((r) => r.hits.map((h) => h.statutorySubstanceId).filter((v) => v !== null)),
        ),
      ]
    : [];
  const actorIds = [...new Set(rows.map((r) => r.decidedBy).filter((v) => v !== null))];
  const [substances, users] = await Promise.all([
    substanceIds.length === 0
      ? []
      : prisma.statutorySubstance.findMany({
          where: { id: { in: substanceIds } },
          select: { id: true, nameJa: true, nameOriginal: true },
        }),
    actorIds.length === 0
      ? []
      : prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true },
        }),
  ]);
  const nameOf = new Map(substances.map((s) => [s.id, s.nameJa ?? s.nameOriginal]));
  const userOf = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));

  return rows
    .map((r) => ({
      categoryId: r.categoryId,
      lawCode: r.category.law.code,
      lawNameJa: r.category.law.nameJa,
      lawNameEn: r.category.law.nameEn,
      lawNameOriginal: r.category.law.nameOriginal,
      categoryNameJa: r.category.nameJa,
      categoryNameEn: r.category.nameEn,
      categoryNameOriginal: r.category.nameOriginal,
      verdict: r.verdict,
      source: r.source,
      needsReview: r.needsReview,
      reviewReasons: r.reviewReasons,
      decidedByName: r.decidedBy ? (userOf.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedNote: r.decidedNote,
      computedAt: r.computedAt.toISOString(),
      hits: withHits
        ? r.hits
            .map((h) => ({
              // 区分そのものが当たったときは、指す法文物質名が無い
              name: h.statutorySubstanceId ? (nameOf.get(h.statutorySubstanceId) ?? null) : null,
              pct: h.pct.toString(),
            }))
            // 多いものから。まず何が効いているかを見たい
            .sort((a, b) => Number(b.pct) - Number(a.pct))
        : [],
      hitsWithheld: !withHits && r.hits.length > 0,
      // 並びは法令 → 区分の順。画面の法規制と同じ並びにする
      _order: [r.category.law.displayOrder, r.category.law.code, r.category.displayOrder] as const,
    }))
    .sort((a, b) => {
      const [ao, ac, ad] = a._order;
      const [bo, bc, bd] = b._order;
      return ao - bo || ac.localeCompare(bc) || ad - bd;
    })
    .map(({ _order, ...rest }) => rest);
}
