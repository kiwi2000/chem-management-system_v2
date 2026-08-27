import { prisma } from "@/lib/db";

/**
 * インベントリの共通処理。
 *
 * **どの API も「現在のバージョン」を軸にする。**インベントリは改訂されるので、
 * どのバージョンを見ているかが決まらないと件数も中身も意味を持たない。
 * 現在のバージョンが立っていないときは、そのことが画面に伝わるよう null を返す。
 */
export async function currentVersion(): Promise<{ id: string; code: string } | null> {
  return prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
}

/**
 * 正規化CASから物質を引く。インベントリの行に物質へのリンクを出すために使う。
 *
 * **物理的な外部キーは無い。**インベントリには物質マスタに無いCASも載っているのが普通で、
 * FK を張ると取り込めなくなる。突き合わせは正規化CASで行い、
 * 見つからなければ「まだ物質として登録していない」という意味になる。
 */
export async function findSubstanceByCas(
  casNormalized: string[],
): Promise<Map<string, { id: string; code: string; nameJa: string; nameEn: string | null }>> {
  const result = new Map<
    string,
    { id: string; code: string; nameJa: string; nameEn: string | null }
  >();
  const cas = [...new Set(casNormalized.filter((c) => c))];
  if (cas.length === 0) return result;

  const rows = await prisma.substance.findMany({
    where: { deletedAt: null, casNormalized: { in: cas } },
    select: { id: true, code: true, nameJa: true, nameEn: true, casNormalized: true },
  });
  for (const s of rows) {
    if (!s.casNormalized || result.has(s.casNormalized)) continue;
    result.set(s.casNormalized, { id: s.id, code: s.code, nameJa: s.nameJa, nameEn: s.nameEn });
  }
  return result;
}

/**
 * バージョンに並んでいるデータソースを、優先度の高い順に返す。
 *
 * 行を足すときの既定と、どれが採られるかの表示に使う。
 * バージョンに並んでいないデータソースは、入れても採られないので出さない。
 */
export async function sourcesOfVersion(
  versionId: string,
): Promise<{ id: string; code: string; priority: number }[]> {
  const rows = await prisma.linkVersionSource.findMany({
    where: { versionId },
    orderBy: { priority: "asc" },
    select: { sourceId: true, priority: true, source: { select: { code: true } } },
  });
  return rows.map((r) => ({ id: r.sourceId, code: r.source.code, priority: r.priority }));
}
