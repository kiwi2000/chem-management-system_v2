import { prisma } from "@/lib/db";

/**
 * 物質に付いている各種番号（化審法番号・EC番号など）。
 *
 * これらの番号は物質そのものの属性ではなく、**あるインベントリが振っているもの**。
 * 物質側に書き写すと外部データベースとの二重管理になるので、
 * CAS番号をたどって引いてくる（決定 0008）。
 *
 * 出どころは**インベントリだけ**。
 * かつては規制区分の official_number も出していたが、
 * 設定する場所が2か所に分かれ、画面に出ているものと触れるものが食い違っていたため畳んだ。
 * 政令番号などは法規制の画面で見るもので、物質の「各種番号」に混ぜない。
 *
 * インベントリの行は**取り込みのときに加工済み**なので、ここは出すだけ。
 * 1つの物質に複数の番号が付くことがある（EC番号・KE番号）。
 *
 * 引けなかった番号は返さない。空行を並べると、登録漏れなのか対象外なのかが
 * 区別できなくなるため。
 */
export interface SubstanceNumber {
  /** インベントリに付けた呼び名。そのまま画面の見出しになる */
  label: string;
  number: string;
  /** どこから来たかを添えるためのもの（「日本 ENCS（化審法）」） */
  source: string;
}

/**
 * CAS番号の集合に対して、番号をまとめて引く。
 * 一覧でも使うので、1ページぶんを1回の問い合わせで取れるようにしてある。
 *
 * **現在のバージョンの行だけを見る。**インベントリは改訂されるので、
 * どのバージョンで引いたかが判定の跡と揃っていないと突き合わせられない。
 *
 * **同じCASが複数のデータソースから取れているときは、優先度の高い1つだけを採る。**
 * CASリンクと同じ解きかた（`listCasLinks`）。混ぜて出すと、
 * どちらが正しいのか読む側に判断させることになる。
 *
 * 並びはインベントリに付けた順（`numberOrder`）。よく引く番号を上に置けるようにするため。
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
  // 現在のバージョンが決まっていなければ番号は引けない。空で返す（画面には節ごと出ない）
  if (!version) return result;

  /*
    「出す」と決めてあり、呼び名も入っているインベントリだけ。
    呼び名が無いと見出しの無い番号が並ぶので、印が立っていても出さない
  */
  const inventories = await prisma.inventory.findMany({
    where: { deletedAt: null, numberShown: true, numberLabel: { not: null } },
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

  const [order, rows] = await Promise.all([
    prisma.linkVersionSource.findMany({
      where: { versionId: version.id },
      select: { sourceId: true, priority: true },
    }),
    prisma.inventoryRow.findMany({
      where: {
        versionId: version.id,
        inventoryId: { in: inventories.map((i) => i.id) },
        casNormalized: { in: cas },
      },
      select: { inventoryId: true, sourceId: true, casNormalized: true, value: true },
      orderBy: { value: "asc" },
    }),
  ]);

  const rank = new Map(order.map((o) => [o.sourceId, o.priority]));
  /** バージョンに並んでいないデータソースは、いつまでも採られない。末尾に置く */
  const rankOf = (sourceId: string) => rank.get(sourceId) ?? Number.MAX_SAFE_INTEGER;

  /*
    インベントリ×CAS ごとに、優先度がいちばん高いデータソースを1つ選ぶ。
    **CAS単位ではなくインベントリ×CAS単位。**EC番号は ECHA から、
    化審法番号は LOLI から、という採りかたができるようにするため
  */
  const best = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.inventoryId}/${row.casNormalized}`;
    const r = rankOf(row.sourceId);
    const cur = best.get(key);
    if (cur === undefined || r < cur) best.set(key, r);
  }

  // インベントリの並び順のまま入れていく（画面はこの順に出す）
  for (const inv of inventories) {
    for (const row of rows) {
      if (row.inventoryId !== inv.id) continue;
      // 採られなかったデータソースの行は出さない
      if (rankOf(row.sourceId) !== best.get(`${row.inventoryId}/${row.casNormalized}`)) continue;
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
