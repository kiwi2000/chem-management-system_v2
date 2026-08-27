import { prisma } from "@/lib/db";
import type { RowRegulationDto, RowStatutoryDto } from "@/lib/types";

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
      hits: { select: { contributions: true, statutorySubstanceId: true } },
      category: {
        select: {
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          displayOrder: true,
          law: {
            select: {
              nameJa: true,
              nameEn: true,
              nameOriginal: true,
              displayOrder: true,
              country: {
                select: {
                  region: {
                    select: { id: true, nameJa: true, nameEn: true, displayOrder: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  /*
    当たった法文物質名の中身は、判定の結果に id しか残っていないので引き直す。
    **区分そのものでまとめて当たったときは id が空**なので、その場合は名前が出ない
  */
  const subIds = [
    ...new Set(rows.flatMap((r) => r.hits.map((h) => h.statutorySubstanceId).filter((x) => !!x))),
  ] as string[];
  const subs =
    subIds.length === 0
      ? []
      : await prisma.statutorySubstance.findMany({
          where: { id: { in: subIds } },
          select: {
            id: true,
            officialNumber: true,
            nameJa: true,
            nameEn: true,
            nameOriginal: true,
            displayOrder: true,
            regulationClass: {
              select: { nameJa: true, nameEn: true, nameOriginal: true },
            },
          },
        });
  const subOf = new Map(subs.map((x) => [x.id, x]));

  /** CAS → 効いている区分。同じ区分に複数の法文物質名で当たっても1つにまとめる */
  const byCas = new Map<string, Map<string, RowRegulationDto>>();
  for (const r of rows) {
    for (const h of r.hits) {
      const contributions = (h.contributions ?? []) as { cas: string }[];
      for (const c of contributions) {
        if (!c.cas) continue;
        const seen = byCas.get(c.cas) ?? new Map<string, RowRegulationDto>();
        const region = r.category.law.country.region;
        // 同じ区分に別の号でも当たることがあるので、消さずに足していく
        const statutory: RowStatutoryDto[] = [...(seen.get(r.categoryId)?.statutory ?? [])];
        const sub = h.statutorySubstanceId ? subOf.get(h.statutorySubstanceId) : undefined;
        if (sub && !statutory.some((x) => x.nameOriginal === sub.nameOriginal)) {
          statutory.push({
            classNameJa: sub.regulationClass.nameJa,
            classNameEn: sub.regulationClass.nameEn,
            classNameOriginal: sub.regulationClass.nameOriginal,
            officialNumber: sub.officialNumber,
            nameJa: sub.nameJa,
            nameEn: sub.nameEn,
            nameOriginal: sub.nameOriginal,
          });
        }
        seen.set(r.categoryId, {
          statutory,
          categoryId: r.categoryId,
          regionId: region.id,
          regionNameJa: region.nameJa,
          regionNameEn: region.nameEn,
          regionOrder: region.displayOrder,
          categoryOrder: r.category.law.displayOrder * 1000 + r.category.displayOrder,
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

  /*
    並びは地域 → 法令 → 区分。
    まとめ表では地域ごとに列をまとめるので、地域が先に来ていないと
    列の並びと中身の並びが食い違う。
  */
  const out = new Map<string, RowRegulationDto[]>();
  for (const [cas, seen] of byCas) {
    out.set(
      cas,
      [...seen.values()].sort(
        (a, b) => a.regionOrder - b.regionOrder || a.categoryOrder - b.categoryOrder,
      ),
    );
  }
  return out;
}
