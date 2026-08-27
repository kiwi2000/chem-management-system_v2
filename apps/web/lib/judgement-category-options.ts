import { pickStatutoryName, type Locale } from "@chem/shared";
import { prisma } from "@/lib/db";
import { CATEGORY_ORDER_BY } from "@/lib/law-order";

/**
 * 製品の一覧で「該当法規制」を選ぶときの選択肢。
 *
 * **判定を持っている区分だけを出す。**
 * 登録されているだけで1件も判定していない区分を並べると、選んでも必ず0件になり、
 * 「当たっていない」のか「まだ調べていない」のかが分からなくなる。
 *
 * 名前は「法令 › 区分」。区分名だけでは、どの法令のものか分からないものがある
 * （第1類物質・第一種指定化学物質など、似た名前が別の法令に並ぶ）。
 */
export async function listJudgementCategoryOptions(
  locale: Locale,
): Promise<{ value: string; label: string }[]> {
  const categories = await prisma.regulationCategory.findMany({
    where: { deletedAt: null, judgements: { some: {} } },
    select: {
      id: true,
      nameJa: true,
      nameEn: true,
      nameOriginal: true,
      law: { select: { nameJa: true, nameEn: true, nameOriginal: true, displayOrder: true } },
    },
    // 並びは判定表と同じ（地域 → 国 → 法令 → 区分）
    orderBy: [...CATEGORY_ORDER_BY],
  });

  return categories.map((c) => ({
    value: c.id,
    label: `${pickStatutoryName(locale, c.law.nameOriginal, c.law.nameJa, c.law.nameEn)} › ${pickStatutoryName(locale, c.nameOriginal, c.nameJa, c.nameEn)}`,
  }));
}
