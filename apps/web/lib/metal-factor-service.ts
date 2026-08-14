import type { MetalConversionFactor } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MetalFactorDto } from "@/lib/types";

export function toMetalFactorDto(
  f: MetalConversionFactor,
  matchedSubstances: { id: string; code: string; nameJa: string; nameEn: string | null }[],
): MetalFactorDto {
  return {
    id: f.id,
    casNumber: f.casNumber,
    metalElement: f.metalElement,
    // 数値は文字列で返す（浮動小数点を経由させない）
    ratioPct: f.ratioPct.toString(),
    updatedAt: f.updatedAt.toISOString(),
    matchedSubstances,
  };
}

/**
 * 係数の CAS に一致する物質を引く。
 * 物理FKは張っていないので、正規化CASで突き合わせる。
 * 同じ CAS を複数の物質が持つことを許しているため、結果は複数になりうる。
 */
export async function findSubstancesByCas(casNormalizedList: string[]) {
  if (casNormalizedList.length === 0) return new Map<string, MatchedSubstance[]>();

  const rows = await prisma.substance.findMany({
    where: { casNormalized: { in: casNormalizedList }, deletedAt: null },
    select: { id: true, code: true, nameJa: true, nameEn: true, casNormalized: true },
    orderBy: { codeNormalized: "asc" },
  });

  const byCas = new Map<string, MatchedSubstance[]>();
  for (const r of rows) {
    if (!r.casNormalized) continue;
    const list = byCas.get(r.casNormalized) ?? [];
    list.push({ id: r.id, code: r.code, nameJa: r.nameJa, nameEn: r.nameEn });
    byCas.set(r.casNormalized, list);
  }
  return byCas;
}

export interface MatchedSubstance {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
}
