import { randomUUID } from "node:crypto";
import type { InventoryRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeAllScores } from "@/lib/score-store";

/**
 * 別の版から、同じデータソースの中身を写す（2026-10-04 指示）。
 *
 * 新しい版を LOLI から作ったとき、手で登録したもの（USER）や CHRIP の中身を前の版のまま使いたい人がいる。
 * 「版が別の版を参照する」作りにすると、データソースごとの版と組み合わせの版の 2 階層が要り、
 * 版のリンクを読むところすべてに手が入る。**写す**なら版は 1 階層のまま、読む側は今のままでよい。
 *
 * - 写すのは CAS リンク（新しい id で作る）・リンクに添える文章・インベントリの行
 * - 写し先（この版 × このデータソース）の中身は**入れ替え**。前の中身は消える
 * - 取込日は写し元のものをそのまま写す（取り込み直したわけではない）
 * - 写したあとで写し元を直しても、こちらは追いかけない（版はその時点の写し）。追いかけたいときは写し直す
 * - 物質のスコアは計算し直す。判定は「要再計算」の印で管理者に知らせる（リンクの更新日時が変わるので自動で出る）
 */

const CHUNK = 2000;

export interface CopyResult {
  removedLinks: number;
  links: number;
  texts: number;
  inventoryRows: number;
}

/** 写し元にできる版。同じデータソースを持ち、中身があるもの（写し先の版は除く） */
export async function copyCandidates(targetVersionId: string, sourceId: string) {
  const rows = await prisma.linkVersionSource.findMany({
    where: { sourceId, versionId: { not: targetVersionId }, version: { deletedAt: null } },
    select: { versionId: true, version: { select: { code: true, asOf: true } } },
  });
  const out = [];
  for (const r of rows) {
    const [links, inventoryRows] = await Promise.all([
      prisma.statutoryCasLink.count({ where: { versionId: r.versionId, sourceId } }),
      prisma.inventoryRow.count({ where: { versionId: r.versionId, sourceId } }),
    ]);
    if (links + inventoryRows === 0) continue;
    out.push({
      versionId: r.versionId,
      versionCode: r.version.code,
      asOf: r.version.asOf.toISOString().slice(0, 10),
      links,
      inventoryRows,
    });
  }
  return out.sort((a, b) => (a.asOf < b.asOf ? 1 : -1));
}

/** 写す。写し先の版 × データソースの行（link_version_sources）は先にある前提 */
export async function copySourceContents(params: {
  fromVersionId: string;
  toVersionId: string;
  sourceId: string;
  actorId: string;
}): Promise<CopyResult> {
  const { fromVersionId, toVersionId, sourceId, actorId } = params;
  const from = await prisma.linkSetVersion.findUniqueOrThrow({ where: { id: fromVersionId } });

  // 写し先の中身を消す（文章はリンクと一緒に消える）
  const removed = await prisma.statutoryCasLink.deleteMany({
    where: { versionId: toVersionId, sourceId },
  });
  await prisma.inventoryRow.deleteMany({ where: { versionId: toVersionId, sourceId } });

  const result: CopyResult = { removedLinks: removed.count, links: 0, texts: 0, inventoryRows: 0 };

  // CAS リンクと文章。文章はリンクの id に付くので、新しい id へ付け替える
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.statutoryCasLink.findMany({
      where: { versionId: fromVersionId, sourceId },
      include: { data: true },
      orderBy: { id: "asc" },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;
    const links = [];
    const texts = [];
    for (const { data, id: _old, createdAt: _c, updatedAt: _u, ...rest } of batch) {
      const id = randomUUID();
      links.push({ ...rest, id, versionId: toVersionId, createdBy: actorId, updatedBy: actorId });
      if (data) texts.push({ ...data, linkId: id });
    }
    const r = await prisma.statutoryCasLink.createMany({ data: links, skipDuplicates: true });
    result.links += r.count;
    if (texts.length > 0) {
      const t = await prisma.statutoryCasLinkData.createMany({ data: texts, skipDuplicates: true });
      result.texts += t.count;
    }
  }

  // インベントリの行
  cursor = undefined;
  for (;;) {
    const batch: InventoryRow[] = await prisma.inventoryRow.findMany({
      where: { versionId: fromVersionId, sourceId },
      orderBy: { id: "asc" },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;
    const r = await prisma.inventoryRow.createMany({
      data: batch.map(({ id: _old, ...rest }) => ({
        ...rest,
        id: randomUUID(),
        versionId: toVersionId,
      })),
      skipDuplicates: true,
    });
    result.inventoryRows += r.count;
  }

  // 取込日は写し元のものをそのまま写す（取り込み直したわけではないので。2026-10-04 指示）
  const fromRow = await prisma.linkVersionSource.findUnique({
    where: { versionId_sourceId: { versionId: fromVersionId, sourceId } },
    select: { loadedAt: true },
  });
  await prisma.linkVersionSource.update({
    where: { versionId_sourceId: { versionId: toVersionId, sourceId } },
    data: { copiedFrom: from.code, loadedAt: fromRow?.loadedAt ?? null, updatedBy: actorId },
  });
  // 有効・無効の切り替えと同じく、物質のスコアはここで計算し直す
  await recomputeAllScores().catch((e) => console.error("score recompute failed:", e));
  return result;
}
