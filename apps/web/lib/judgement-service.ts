import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MatchedProductDto, ProductJudgementDto } from "@/lib/types";

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
      hits: { select: { statutorySubstanceId: true, total: true, contributions: true } },
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
          select: { id: true, nameJa: true, nameOriginal: true, officialNumber: true },
        }),
    actorIds.length === 0
      ? []
      : prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true },
        }),
  ]);
  const infoOf = new Map(substances.map((s) => [s.id, s]));
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
            .map((h) => {
              // 区分そのものが当たったときは、指す法文物質名が無い
              const info = h.statutorySubstanceId ? infoOf.get(h.statutorySubstanceId) : undefined;
              return {
                name: info ? (info.nameJa ?? info.nameOriginal) : null,
                officialNumber: info?.officialNumber ?? null,
                contributions: (h.contributions ?? []) as { cas: string; pct: string }[],
                total: h.total?.toString() ?? null,
              };
            })
            // 多いものから。まず何が効いているかを見たい
            .sort((a, b) => maxPct(b) - maxPct(a))
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

/** 並べ替えに使う代表値。合計が無いときは、いちばん大きい寄与を見る */
function maxPct(h: { total: string | null; contributions: { pct: string }[] }): number {
  if (h.total !== null) return Number(h.total);
  return Math.max(0, ...h.contributions.map((c) => Number(c.pct)));
}

/**
 * この区分に当たる製品を出す（法規制の画面からの逆引き）。
 *
 * 「この法令に引っかかる製品はどれか」を、製品を1つずつ開かずに知るためのもの。
 *
 * 返すのは2種類だけ。
 *
 *   該当したもの                   … この区分に引っかかる製品
 *   非該当だが確認が残っているもの … **引っかからないと言い切れていない**製品
 *
 * 2つ目を落とすと、法規制の側から見たときに
 * 「調べたが当たらなかった」ものと「判断できなかった」ものが同じ扱いになる。
 * 換算係数が無い・組成が分からない、といった理由で判断できなかったものこそ
 * 人に見てほしいので、必ず並べる。
 *
 * **これ以外の非該当は返さない。**全製品が並んで、目当てのものが埋もれる。
 *
 * `visibility` には製品一覧と同じ条件を渡すこと。
 * **見えない製品は件数にも入れない。**在ることが分かるだけで
 * 「この会社はこの規制物質を扱っている」と伝わってしまう。
 */
export async function toMatchedProducts(
  categoryId: string,
  visibility: Prisma.ProductWhereInput,
  withHits: boolean,
): Promise<MatchedProductDto[]> {
  const rows = await prisma.productJudgement.findMany({
    where: {
      categoryId,
      OR: [{ verdict: "APPLICABLE" }, { needsReview: true }],
      product: { deletedAt: null, ...visibility },
    },
    select: {
      verdict: true,
      source: true,
      needsReview: true,
      reviewReasons: true,
      computedAt: true,
      product: { select: { id: true, code: true, nameJa: true, nameEn: true, status: true } },
      hits: { select: { statutorySubstanceId: true, total: true, contributions: true } },
    },
  });

  const substanceIds = withHits
    ? [
        ...new Set(
          rows.flatMap((r) => r.hits.map((h) => h.statutorySubstanceId).filter((v) => v !== null)),
        ),
      ]
    : [];
  const substances =
    substanceIds.length === 0
      ? []
      : await prisma.statutorySubstance.findMany({
          where: { id: { in: substanceIds } },
          select: { id: true, nameJa: true, nameOriginal: true, officialNumber: true },
        });
  const infoOf = new Map(substances.map((s) => [s.id, s]));

  return (
    rows
      .map((r) => ({
        productId: r.product.id,
        code: r.product.code,
        nameJa: r.product.nameJa,
        nameEn: r.product.nameEn,
        status: r.product.status,
        verdict: r.verdict,
        source: r.source,
        needsReview: r.needsReview,
        reviewReasons: r.reviewReasons,
        computedAt: r.computedAt.toISOString(),
        hits: withHits
          ? r.hits
              .map((h) => {
                const info = h.statutorySubstanceId
                  ? infoOf.get(h.statutorySubstanceId)
                  : undefined;
                return {
                  name: info ? (info.nameJa ?? info.nameOriginal) : null,
                  officialNumber: info?.officialNumber ?? null,
                  contributions: (h.contributions ?? []) as { cas: string; pct: string }[],
                  total: h.total?.toString() ?? null,
                };
              })
              .sort((a, b) => maxPct(b) - maxPct(a))
          : [],
        hitsWithheld: !withHits && r.hits.length > 0,
      }))
      /*
        該当したものを先に並べる。それがこの画面の答えだから。
        判断できなかったものは、そのあとに続ける（付け足しであることが並びで分かる）。
      */
      .sort(
        (a, b) =>
          Number(b.verdict === "APPLICABLE") - Number(a.verdict === "APPLICABLE") ||
          a.code.localeCompare(b.code, undefined, { numeric: true }),
      )
  );
}
