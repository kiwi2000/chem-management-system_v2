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
                  displayOrder: true,
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
          /*
            並びは国 → 法律 → 区分。地域は列をまとめる単位なので `regionOrder` が持つ。
            **法律の番号は国ごとに1から振ってある**ので、国を混ぜると割り込みが起きる
          */
          categoryOrder:
            (r.category.law.country.displayOrder * 10000 + r.category.law.displayOrder) * 1000 +
            r.category.displayOrder,
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
    並びは地域 → 法律 → 区分。
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

/**
 * 「CAS は載っているのに、いまは当たっていない」法文物質名を CAS ごとに引く。
 *
 * **含有率が足りないだけのものを知らせるためのもの。**配合が少し変われば
 * 規制を受けるので、あらかじめ見えているとよい。
 *
 * 判定はここでし直さない。対応表（法文物質名 ↔ CAS）を引いて、
 * **すでに当たっているものを差し引く**だけにする。
 *
 * 拾わないもの
 *   - **除外の印が立った対応**（[judge-store.ts](judge-store.ts) と同じ扱い）。
 *     人が調べて当たらないと決めたものなので、知らせても仕方がない
 *   - 区分そのものでまとめて当たっている区分。中の法文物質名は全部当たっている
 */
export async function nearMissByCas(
  productId: string,
  casNormalized: string[],
): Promise<Map<string, RowRegulationDto[]>> {
  const empty = new Map<string, RowRegulationDto[]>();
  const cas = [...new Set(casNormalized.filter((c) => c))];
  if (cas.length === 0) return empty;

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true },
  });
  if (!version) return empty;

  const [links, judgements] = await Promise.all([
    prisma.statutoryCasLink.findMany({
      where: { versionId: version.id, casNormalized: { in: cas }, excluded: false },
      select: {
        casNormalized: true,
        statutorySubstance: {
          select: {
            id: true,
            officialNumber: true,
            nameJa: true,
            nameEn: true,
            nameOriginal: true,
            displayOrder: true,
            deletedAt: true,
            regulationClass: {
              select: {
                nameJa: true,
                nameEn: true,
                nameOriginal: true,
                category: {
                  select: {
                    id: true,
                    nameJa: true,
                    nameEn: true,
                    nameOriginal: true,
                    displayOrder: true,
                    deletedAt: true,
                    law: {
                      select: {
                        nameJa: true,
                        nameEn: true,
                        nameOriginal: true,
                        displayOrder: true,
                        country: {
                          select: {
                            displayOrder: true,
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
            },
          },
        },
      },
    }),
    prisma.productJudgement.findMany({
      where: { productId, verdict: "APPLICABLE" },
      select: { categoryId: true, hits: { select: { statutorySubstanceId: true } } },
    }),
  ]);

  /** すでに当たっている法文物質名 */
  const hitSubstances = new Set<string>();
  /** 区分そのものでまとめて当たった区分。中身は全部当たり扱いにする */
  const hitCategories = new Set<string>();
  for (const j of judgements) {
    for (const h of j.hits) {
      if (h.statutorySubstanceId) hitSubstances.add(h.statutorySubstanceId);
      else hitCategories.add(j.categoryId);
    }
  }

  /** CAS → 区分 → その区分で当たっていない法文物質名 */
  const byCas = new Map<string, Map<string, RowRegulationDto>>();
  for (const l of links) {
    const sub = l.statutorySubstance;
    if (sub.deletedAt) continue;
    if (hitSubstances.has(sub.id)) continue;

    const cat = sub.regulationClass.category;
    if (cat.deletedAt || hitCategories.has(cat.id)) continue;

    const region = cat.law.country.region;
    let cats = byCas.get(l.casNormalized);
    if (!cats) {
      cats = new Map();
      byCas.set(l.casNormalized, cats);
    }
    let entry = cats.get(cat.id);
    if (!entry) {
      entry = {
        categoryId: cat.id,
        regionId: region.id,
        regionNameJa: region.nameJa,
        regionNameEn: region.nameEn,
        regionOrder: region.displayOrder,
        categoryOrder: cat.law.displayOrder * 1000 + cat.displayOrder,
        lawNameJa: cat.law.nameJa,
        lawNameEn: cat.law.nameEn,
        lawNameOriginal: cat.law.nameOriginal,
        categoryNameJa: cat.nameJa,
        categoryNameEn: cat.nameEn,
        categoryNameOriginal: cat.nameOriginal,
        statutory: [],
        // 当たっていないものなので、確認が残っているかは関係ない
        needsReview: false,
      };
      cats.set(cat.id, entry);
    }
    // 同じ法文物質名に複数の CAS で結ばれていても1つにする
    if (entry.statutory.some((x) => x.nameOriginal === sub.nameOriginal)) continue;
    entry.statutory.push({
      classNameJa: sub.regulationClass.nameJa,
      classNameEn: sub.regulationClass.nameEn,
      classNameOriginal: sub.regulationClass.nameOriginal,
      officialNumber: sub.officialNumber,
      nameJa: sub.nameJa,
      nameEn: sub.nameEn,
      nameOriginal: sub.nameOriginal,
    });
  }

  const out = new Map<string, RowRegulationDto[]>();
  for (const [c, cats] of byCas) {
    out.set(
      c,
      [...cats.values()].sort(
        (a, b) => a.regionOrder - b.regionOrder || a.categoryOrder - b.categoryOrder,
      ),
    );
  }
  return out;
}
