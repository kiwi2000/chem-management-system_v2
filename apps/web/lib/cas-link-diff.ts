import { prisma } from "@/lib/db";

/**
 * 2つのバージョンの対象CASの差分（同じデータソースどうし）。
 *
 * 突き合わせの鍵は「法文物質名 × CAS」。法文物質名はバージョンをまたいで同じ行を指すので、
 * これで「増えた」「消えた」「変わった」が決まる。どちらにもあって同じものは「変更なし」。
 * 変更なしの行も置くのは、絞り込みのボタンで「変更なし」を押したときにも同じ表で出せるようにするため
 * （何も押していなければ画面側が除く）。
 * 「変わった」は、該非か出典データの文章（原文。前後の空白は無視）が違うもの。
 * 日本語訳は比べない。訳が付いたかどうかは出どころの都合で、法規制の中身の変化ではない
 * （2026Q2 は訳なし、2026Q3 は訳ありなので、比べると全部が「変わった」になった）。
 *
 * 20万行どうしの突き合わせを見るたびにやると重いので、結果は表に置く。
 * リンクが変わっていなければ前回の結果を使い、変わっていれば作り直す。
 */
export interface DiffRun {
  added: number;
  removed: number;
  changed: number;
  computedAt: Date;
}

/** 2つの版のそのデータソースのリンクが最後に変わった時刻。これより前に作った差分は古い */
async function linksChangedAt(
  versionId: string,
  againstId: string,
  sourceId: string,
): Promise<Date | null> {
  const r = await prisma.statutoryCasLink.aggregate({
    where: { versionId: { in: [versionId, againstId] }, sourceId },
    _max: { updatedAt: true },
  });
  return r._max.updatedAt;
}

/** 差分を用意する。前回の結果が新しければそれを返し、古ければ作り直す */
export async function ensureDiffRun(
  versionId: string,
  againstId: string,
  sourceId: string,
): Promise<DiffRun> {
  const key = { versionId_againstId_sourceId: { versionId, againstId, sourceId } };
  const [existing, changedAt] = await Promise.all([
    prisma.statutoryCasLinkDiffRun.findUnique({ where: key }),
    linksChangedAt(versionId, againstId, sourceId),
  ]);
  if (existing && (changedAt === null || existing.computedAt >= changedAt)) return existing;

  return prisma.$transaction(
    async (tx) => {
      await tx.statutoryCasLinkDiff.deleteMany({ where: { versionId, againstId, sourceId } });
      /*
        突き合わせは DB の中で一気にやる（1行ずつ引くと数十万回になる）。
        両側の版のリンクに出どころの文章を付けて、外部結合で並べる。
        片側にしか無ければ 増えた／消えた、両方にあって中身が違えば 変わった、同じなら 変更なし
      */
      await tx.$executeRaw`
        INSERT INTO "statutory_cas_link_diffs"
          ("id", "version_id", "against_id", "source_id", "statutory_substance_id", "cas_normalized",
           "kind", "current_link_id", "previous_link_id", "computed_at")
        SELECT gen_random_uuid()::text, ${versionId}, ${againstId}, ${sourceId},
               COALESCE(c.statutory_substance_id, p.statutory_substance_id),
               COALESCE(c.cas_normalized, p.cas_normalized),
               (CASE WHEN p.id IS NULL THEN 'ADDED'
                     WHEN c.id IS NULL THEN 'REMOVED'
                     WHEN c.excluded <> p.excluded
                       OR COALESCE(btrim(c.text), '') <> COALESCE(btrim(p.text), '') THEN 'CHANGED'
                     ELSE 'UNCHANGED' END)::"LinkDiffKind",
               c.id, p.id, now()
        FROM (SELECT l.id, l.statutory_substance_id, l.cas_normalized, l.excluded, d.text
                FROM "statutory_cas_links" l
                LEFT JOIN "statutory_cas_link_data" d ON d.link_id = l.id
               WHERE l.version_id = ${versionId} AND l.source_id = ${sourceId}) c
        FULL OUTER JOIN
             (SELECT l.id, l.statutory_substance_id, l.cas_normalized, l.excluded, d.text
                FROM "statutory_cas_links" l
                LEFT JOIN "statutory_cas_link_data" d ON d.link_id = l.id
               WHERE l.version_id = ${againstId} AND l.source_id = ${sourceId}) p
          ON c.statutory_substance_id = p.statutory_substance_id
         AND c.cas_normalized = p.cas_normalized
      `;
      const counts = await tx.statutoryCasLinkDiff.groupBy({
        by: ["kind"],
        where: { versionId, againstId, sourceId },
        _count: { _all: true },
      });
      const of = (kind: "ADDED" | "REMOVED" | "CHANGED") =>
        counts.find((c) => c.kind === kind)?._count._all ?? 0;
      const summary = {
        added: of("ADDED"),
        removed: of("REMOVED"),
        changed: of("CHANGED"),
        computedAt: new Date(),
      };
      await tx.statutoryCasLinkDiffRun.upsert({
        where: key,
        update: summary,
        create: { versionId, againstId, sourceId, ...summary },
      });
      return summary;
    },
    // 20万行どうしの突き合わせ。既定の5秒では足りないことがある
    { timeout: 180_000, maxWait: 10_000 },
  );
}
