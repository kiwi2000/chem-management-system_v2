import { prisma } from "@/lib/db";
import type { RowRegulationDto } from "@/lib/types";

/**
 * CASごとに「どの規制区分に効いているか」を引く。
 *
 * **保持してある判定結果から作る。ここで判定し直さない。**
 * 判定の計算を2か所に置くと、まとめ表の印と下の判定表が食い違う。
 * 食い違ったとき、どちらが正しいのか誰にも分からなくなる。
 *
 * 拾うのは**該当したものだけ**。非該当まで印を付けると、
 * ほぼ全部の CAS に全部の区分が並び、印としての意味が無くなる。
 */
export async function regulationsByCas(
  productId: string,
): Promise<Map<string, RowRegulationDto[]>> {
  const rows = await prisma.productJudgement.findMany({
    where: { productId, verdict: "APPLICABLE" },
    select: {
      categoryId: true,
      needsReview: true,
      hits: { select: { contributions: true } },
      category: {
        select: {
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          displayOrder: true,
          law: { select: { nameJa: true, nameEn: true, nameOriginal: true, displayOrder: true } },
        },
      },
    },
  });

  /** CAS → 効いている区分。同じ区分に複数の法文物質名で当たっても1つにまとめる */
  const byCas = new Map<string, Map<string, RowRegulationDto>>();
  for (const r of rows) {
    for (const h of r.hits) {
      const contributions = (h.contributions ?? []) as { cas: string }[];
      for (const c of contributions) {
        if (!c.cas) continue;
        const seen = byCas.get(c.cas) ?? new Map<string, RowRegulationDto>();
        seen.set(r.categoryId, {
          categoryId: r.categoryId,
          lawNameJa: r.category.law.nameJa,
          lawNameEn: r.category.law.nameEn,
          lawNameOriginal: r.category.law.nameOriginal,
          categoryNameJa: r.category.nameJa,
          categoryNameEn: r.category.nameEn,
          categoryNameOriginal: r.category.nameOriginal,
          needsReview: r.needsReview,
        });
        byCas.set(c.cas, seen);
      }
    }
  }

  // 並びは法令 → 区分。下の判定表と同じ順にする（目が行き来しても迷わないように）
  const order = new Map(
    rows.map((r) => [r.categoryId, [r.category.law.displayOrder, r.category.displayOrder]]),
  );
  const out = new Map<string, RowRegulationDto[]>();
  for (const [cas, seen] of byCas) {
    out.set(
      cas,
      [...seen.values()].sort((a, b) => {
        const [al = 0, ac = 0] = order.get(a.categoryId) ?? [];
        const [bl = 0, bc = 0] = order.get(b.categoryId) ?? [];
        return al - bl || ac - bc;
      }),
    );
  }
  return out;
}
