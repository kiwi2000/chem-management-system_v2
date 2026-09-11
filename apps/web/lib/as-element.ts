import type { AggregationMode } from "@prisma/client";
import { prisma } from "@/lib/db";

/** 「鉛として」の鉛。画面で法文物質名の後ろに添える */
export interface AsElementDto {
  symbol: string;
  nameJa: string;
  nameEn: string;
}

interface AggregationSetting {
  aggregation: AggregationMode;
  metalEtc: string | null;
}

/** 元素記号 → 名前。数十件なので毎回まとめて引く */
export async function loadElementNames(): Promise<Map<string, { nameJa: string; nameEn: string }>> {
  const rows = await prisma.element.findMany({
    where: { deletedAt: null },
    select: { symbol: true, nameJa: true, nameEn: true },
  });
  return new Map(rows.map((e) => [e.symbol, { nameJa: e.nameJa, nameEn: e.nameEn }]));
}

/**
 * その法文物質名が元素換算でまとめて判定されるなら、その元素。そうでなければ null。
 * **区分の側でまとめると決めていれば区分の設定、そうでなければ法文物質名の設定**
 * （判定と同じ優先。`judge-calc.ts`）。元素の名前が登録されていなければ記号のまま出す
 */
export function asElementOf(
  names: Map<string, { nameJa: string; nameEn: string }>,
  category: AggregationSetting,
  substance: AggregationSetting,
): AsElementDto | null {
  const effective = category.aggregation !== "NONE" ? category : substance;
  if (effective.aggregation !== "ELEMENT" || !effective.metalEtc) return null;
  const symbol = effective.metalEtc;
  const name = names.get(symbol);
  return { symbol, nameJa: name?.nameJa ?? symbol, nameEn: name?.nameEn ?? symbol };
}
