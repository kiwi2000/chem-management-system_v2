import type { Language } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { LanguageDto } from "@/lib/types";

/** 言語。法規制の名称で「原文の言語」として選ぶ */
export function toLanguageDto(l: Language): LanguageDto {
  return {
    id: l.id,
    code: l.code,
    nameJa: l.nameJa,
    nameEn: l.nameEn,
    displayOrder: l.displayOrder,
  };
}

/**
 * その言語コードを使っている法規制の数。
 * 名称の言語は各表に文字列で入っているので、4つの表を足し合わせる
 * （外部キーにしていないのは、分類だけ空を許すため）。
 */
export async function countLanguageUses(code: string): Promise<number> {
  const [laws, categories, classes, substances] = await Promise.all([
    prisma.law.count({ where: { nameLang: code, deletedAt: null } }),
    prisma.regulationCategory.count({ where: { nameLang: code, deletedAt: null } }),
    prisma.regulationClass.count({ where: { nameLang: code, deletedAt: null } }),
    prisma.statutorySubstance.count({ where: { nameLang: code, deletedAt: null } }),
  ]);
  return laws + categories + classes + substances;
}

/** 選択肢として使う一覧。並び順で返す */
export async function listLanguages(): Promise<LanguageDto[]> {
  const items = await prisma.language.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  return items.map(toLanguageDto);
}
