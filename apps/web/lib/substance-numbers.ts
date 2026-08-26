import { prisma } from "@/lib/db";

/**
 * 物質に付いている各種番号（化審法番号・EC番号など）。
 *
 * これらの番号は物質そのものの属性ではなく、**ある名簿が振っているもの**。
 * 物質側に書き写すと外部データベースとの二重管理になるので、
 * CAS番号をたどって引いてくる（決定 0008）。
 *
 * 出どころは2つある。
 *
 *   インベントリ … 名簿の行。**取り込みのときに加工済み**なので、ここは出すだけ。
 *                  1つの物質に複数の番号が付くことがある（EC番号・KE番号）
 *   規制区分     … 法文物質名の official_number。政令番号など
 *
 * どちらも**呼び名が入っているものだけ**を出す。全部出すと1物質で何十行にもなり、
 * 引きたい番号が埋もれる。
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

/**
 * 並びは **設定した順**（システム→設定「物質に出す番号」）。
 * よく引く番号を上に置けるようにするため、法令の並びとは別に持つ。
 * 同じ順のときは法令 → 区分 → 番号 に落ちる。
 */
const ORDER = [
  { statutorySubstance: { regulationClass: { category: { numberOrder: "asc" } } } },
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

  /*
    名簿のぶんを**先に**並べる。
    引かれるのはインベントリ番号（化審法番号・EC番号など）が中心で、
    規制区分の番号（政令番号など）はその後で見るものだから。
  */
  const fromInventories = await listFromInventories(cas);
  for (const [key, rows] of fromInventories) {
    result.set(key, [...rows, ...(result.get(key) ?? [])]);
  }
  return result;
}

/**
 * 名簿（インベントリ）から引く。
 *
 * 行はすでに仕上がった値を持っているので、**そのまま出すだけ**。
 * 取り出し（正規表現）は取り込みが受け持っている。
 *
 * 名簿の並び（`numberOrder`）どおりに返す。よく引く番号を上に置けるようにするため。
 */
async function listFromInventories(cas: string[]): Promise<Map<string, SubstanceNumber[]>> {
  const result = new Map<string, SubstanceNumber[]>();
  const inventories = await prisma.inventory.findMany({
    where: { deletedAt: null, numberLabel: { not: null } },
    select: {
      id: true,
      nameJa: true,
      nameOriginal: true,
      numberLabel: true,
      country: { select: { nameJa: true } },
    },
    orderBy: { numberOrder: "asc" },
  });
  if (inventories.length === 0) return result;

  const rows = await prisma.inventoryRow.findMany({
    where: { inventoryId: { in: inventories.map((i) => i.id) }, casNormalized: { in: cas } },
    select: { inventoryId: true, casNormalized: true, value: true },
    orderBy: { value: "asc" },
  });

  // 名簿の並び順のまま入れていく（画面はこの順に出す）
  for (const inv of inventories) {
    for (const row of rows) {
      if (row.inventoryId !== inv.id) continue;
      const list = result.get(row.casNormalized) ?? [];
      list.push({
        label: inv.numberLabel as string,
        number: row.value,
        source: `${inv.country.nameJa} ${inv.nameJa ?? inv.nameOriginal}`,
      });
      result.set(row.casNormalized, list);
    }
  }
  return result;
}

/** 1つの物質のぶん */
export async function listNumbers(casNormalized: string | null): Promise<SubstanceNumber[]> {
  if (!casNormalized) return [];
  const map = await listNumbersByCas([casNormalized]);
  return map.get(casNormalized) ?? [];
}
