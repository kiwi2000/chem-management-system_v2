import { IMPURITY_NONE } from "@chem/shared";
import type { ImpurityType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ImpurityTypeDto } from "@/lib/types";

/**
 * 不純物種別（S21）。
 *
 * 「同じ該非判定になる不純物どうし」をまとめた区分を物質に持たせ、
 * 種別ごとに「どの規制区分・法文物質名で非該当にするか」を設定する。
 *
 * 0「不純物ではない」は除外の設定を持たない（データソースの合算だけで決まる）。
 * 判定での使われかたは lib/judge-store.ts の `resolverFor`
 */

export function toImpurityTypeDto(p: ImpurityType, substanceCount: number): ImpurityTypeDto {
  return {
    id: p.id,
    code: p.code,
    nameJa: p.nameJa,
    nameEn: p.nameEn,
    note: p.note,
    displayOrder: p.displayOrder,
    builtin: p.builtin,
    /** 0 は除外の設定を持たない */
    isNone: p.id === IMPURITY_NONE,
    substanceCount,
  };
}

/** 種別ごとの、使っている物質の数（消してよいかの判断に要る） */
export async function countSubstancesByType(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.substance.groupBy({
    by: ["impurityTypeId"],
    where: { impurityTypeId: { in: ids }, deletedAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.impurityTypeId, r._count._all]));
}
