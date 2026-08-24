import { prisma } from "@/lib/db";

/**
 * 物質に付いている各種番号（官報公示整理番号・EC番号など）。
 *
 * これらの番号は物質そのものの属性ではなく、**あるインベントリが振っているもの**。
 * 物質側に書き写すと外部データベースとの二重管理になるので、
 * 「番号としての呼び名」が入っている区分をたどって引いてくる（決定 0008）。
 *
 *   物質 → CAS番号 → CASリンク（現在版）→ 法文物質名 → officialNumber
 *
 * 引けなかった番号は返さない。空行を並べると、登録漏れなのか対象外なのかが
 * 区別できなくなるため。
 */
export interface SubstanceNumber {
  /** 区分に付けた呼び名。そのまま画面の見出しになる */
  label: string;
  number: string;
  /** どこから来たかを添えるためのもの（「化審法 既存化学物質名簿」） */
  source: string;
}

/** 並びは 法令の並び順 → 区分の並び順 → 番号。設定を増やさずに決まる */
const ORDER = [
  { statutorySubstance: { regulationClass: { category: { law: { displayOrder: "asc" } } } } },
  { statutorySubstance: { regulationClass: { category: { displayOrder: "asc" } } } },
  { statutorySubstance: { officialNumber: "asc" } },
] as const;

/**
 * CAS番号の集合に対して、番号をまとめて引く。
 * 一覧でも使うので、1ページぶんを1回の問い合わせで取れるようにしてある。
 */
export async function listNumbersByCas(
  casNormalized: string[],
): Promise<Map<string, SubstanceNumber[]>> {
  const result = new Map<string, SubstanceNumber[]>();
  const cas = [...new Set(casNormalized.filter((c) => c))];
  if (cas.length === 0) return result;

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true },
  });
  // 現在版が決まっていなければ番号は引けない。空で返す（画面には節ごと出ない）
  if (!version) return result;

  const links = await prisma.statutoryCasLink.findMany({
    where: {
      versionId: version.id,
      casNormalized: { in: cas },
      // 「該当しない」と登録されたものは番号ではないので外す
      excluded: false,
      statutorySubstance: {
        deletedAt: null,
        officialNumber: { not: null },
        regulationClass: { category: { numberLabel: { not: null }, deletedAt: null } },
      },
    },
    select: {
      casNormalized: true,
      statutorySubstance: {
        select: {
          officialNumber: true,
          regulationClass: {
            select: {
              category: {
                select: {
                  numberLabel: true,
                  nameOriginal: true,
                  nameJa: true,
                  law: { select: { nameJa: true, nameOriginal: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [...ORDER],
  });

  for (const l of links) {
    const c = l.statutorySubstance.regulationClass.category;
    const rows = result.get(l.casNormalized) ?? [];
    rows.push({
      label: c.numberLabel!,
      number: l.statutorySubstance.officialNumber!,
      source: `${c.law.nameJa ?? c.law.nameOriginal} ${c.nameJa ?? c.nameOriginal}`,
    });
    result.set(l.casNormalized, rows);
  }
  return result;
}

/** 1つの物質のぶん */
export async function listNumbers(casNormalized: string | null): Promise<SubstanceNumber[]> {
  if (!casNormalized) return [];
  const map = await listNumbersByCas([casNormalized]);
  return map.get(casNormalized) ?? [];
}
