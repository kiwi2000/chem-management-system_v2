import type { LinkSetVersion, LinkVersionSource, Source } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  LinkSetVersionDto,
  LinkVersionSourceDto,
  SourceDto,
  StatutoryCasLinkDto,
} from "@/lib/types";

export function toSourceDto(s: Source): SourceDto {
  return { id: s.id, code: s.code, note: s.note, color: s.color, mark: s.mark };
}

export function toLinkSetVersionDto(v: LinkSetVersion): LinkSetVersionDto {
  return {
    id: v.id,
    code: v.code,
    isCurrent: v.isCurrent,
    currentPinned: v.currentPinned,
    sequence: v.sequence,
  };
}

/**
 * 現在のバージョンを必ず1つに保つ。
 *
 * 利用者が選んでいれば（currentPinned）それに従い、選んでいなければ
 * **通番がいちばん大きいもの**を自動で現在にする。一覧の並び（通番の降順）と
 * 同じなので、「いちばん上のものが現在」と見たままになる。
 *
 * バージョンを足した・消したあとに毎回呼ぶ。
 * テーブル側に「is_current が真の行は1件」という制約があるので、外してから立てる。
 */
export async function ensureCurrentVersion(actorId: string): Promise<void> {
  const pinned = await prisma.linkSetVersion.findFirst({
    where: { deletedAt: null, currentPinned: true },
  });
  const target =
    pinned ??
    (await prisma.linkSetVersion.findFirst({
      where: { deletedAt: null },
      orderBy: [{ sequence: "desc" }, { codeNormalized: "desc" }],
    }));

  if (!target) {
    // バージョンが1件も無い。立っているものがあれば下ろす
    await prisma.linkSetVersion.updateMany({
      where: { isCurrent: true },
      data: { isCurrent: false },
    });
    return;
  }
  if (target.isCurrent) return;

  await prisma.$transaction([
    prisma.linkSetVersion.updateMany({
      where: { isCurrent: true },
      data: { isCurrent: false, updatedBy: actorId },
    }),
    prisma.linkSetVersion.update({
      where: { id: target.id },
      data: { isCurrent: true, updatedBy: actorId },
    }),
  ]);
}

/** データソース（バージョン × 種別）。画面には両方のコードを出すので、一緒に持たせる */
export function toLinkVersionSourceDto(
  row: LinkVersionSource & {
    version: { code: string };
    source: { code: string; color: string | null; mark: string | null };
  },
  linkCount: number,
): LinkVersionSourceDto {
  return {
    id: row.id,
    versionId: row.versionId,
    versionCode: row.version.code,
    sourceId: row.sourceId,
    sourceCode: row.source.code,
    sourceColor: row.source.color,
    sourceMark: row.source.mark,
    priority: row.priority,
    note: row.note,
    loadedAt: row.loadedAt?.toISOString() ?? null,
    linkCount,
  };
}

/**
 * ある法文物質名に結び付いているCASを、データソースごとに全部返す。
 *
 * 同じCASでもデータソースの数だけ行が出る。まとめてしまうと、
 * どのデータソースを直せばよいかが分からなくなるため。
 *
 * 「使用」は優先度で解いた結果。CASごとに、そのバージョンで優先度がいちばん高い
 * データソースの行だけが採られる。非該当（excluded）が採られたときは、
 * それより下位に該当の行があっても当たらない。
 */
export async function listCasLinks(
  versionId: string,
  statutorySubstanceId: string,
): Promise<StatutoryCasLinkDto[]> {
  const [order, links] = await Promise.all([
    prisma.linkVersionSource.findMany({
      where: { versionId },
      select: { sourceId: true, priority: true },
    }),
    prisma.statutoryCasLink.findMany({
      where: { versionId, statutorySubstanceId },
      include: {
        source: { select: { code: true } },
        // 出どころの文章。無いリンクのほうが多いので別テーブル
        data: { select: { text: true, textJa: true } },
      },
    }),
  ]);

  /*
    そのCASが何なのかは、物質マスタの代表物質から引く（組成の合算と同じやり方）。
    リンクさせるCASは物質マスタに載っている前提だが、載っていなければ空で返す。
  */
  const reps = await prisma.substance.findMany({
    where: {
      deletedAt: null,
      isCasRepresentative: true,
      casNormalized: { in: [...new Set(links.map((l) => l.casNormalized))] },
    },
    select: { id: true, casNormalized: true, nameJa: true, nameEn: true },
  });
  const nameByCas = new Map(reps.map((r) => [r.casNormalized ?? "", r]));

  const rank = new Map(order.map((o) => [o.sourceId, o.priority]));
  /** バージョンに並んでいないデータソースは、いつまでも採られない。並びも末尾に置く */
  const rankOf = (sourceId: string) => rank.get(sourceId) ?? Number.MAX_SAFE_INTEGER;

  // CASごとに、いちばん優先度の高い行を1つだけ「使用」にする
  const best = new Map<string, { id: string; rank: number }>();
  for (const l of links) {
    const r = rankOf(l.sourceId);
    const cur = best.get(l.casNormalized);
    if (!cur || r < cur.rank) best.set(l.casNormalized, { id: l.id, rank: r });
  }

  return links
    .map((l) => ({
      id: l.id,
      versionId: l.versionId,
      statutorySubstanceId: l.statutorySubstanceId,
      sourceId: l.sourceId,
      sourceCode: l.source.code,
      casNumber: l.casNumber,
      casNormalized: l.casNormalized,
      substanceId: nameByCas.get(l.casNormalized)?.id ?? null,
      substanceNameJa: nameByCas.get(l.casNormalized)?.nameJa ?? null,
      substanceNameEn: nameByCas.get(l.casNormalized)?.nameEn ?? null,
      excluded: l.excluded,
      note: l.note,
      used: best.get(l.casNormalized)?.id === l.id,
      orphan: !rank.has(l.sourceId),
      data: l.data?.text ?? null,
      dataJa: l.data?.textJa ?? null,
    }))
    .sort(
      (a, b) =>
        a.casNormalized.localeCompare(b.casNormalized) ||
        rankOf(a.sourceId) - rankOf(b.sourceId) ||
        a.sourceCode.localeCompare(b.sourceCode),
    );
}
