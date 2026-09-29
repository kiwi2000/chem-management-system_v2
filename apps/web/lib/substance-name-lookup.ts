import { prisma } from "@/lib/db";
import type { SubstanceNameLookup } from "@/lib/list-columns";

/**
 * 物質名の語ごとに、その名前（別名も）を持つ物質の正規化 CAS と id を引く。
 * 一覧の絞り込みが展開結果の表（名前を持たない）を探すときの下調べ（`list-columns` の `SubstanceNameLookup`）
 */
export async function lookupSubstanceNames(words: string[]): Promise<SubstanceNameLookup> {
  const lookup: SubstanceNameLookup = new Map();
  for (const w of words) {
    const match = { contains: w, mode: "insensitive" as const };
    const subs = await prisma.substance.findMany({
      where: {
        deletedAt: null,
        OR: [
          { nameJa: match },
          { nameEn: match },
          { aliases: { some: { OR: [{ nameJa: match }, { nameEn: match }] } } },
        ],
      },
      select: { id: true, casNormalized: true },
    });
    lookup.set(w, {
      cas: [...new Set(subs.map((x) => x.casNormalized).filter((c): c is string => !!c))],
      ids: subs.map((x) => x.id),
    });
  }
  return lookup;
}
