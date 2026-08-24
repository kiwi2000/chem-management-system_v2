import type { LinkSetVersion, LinkVersionSource, Source } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { LinkSetVersionDto, LinkVersionSourceDto, SourceDto } from "@/lib/types";

export function toSourceDto(s: Source): SourceDto {
  return { id: s.id, code: s.code, note: s.note };
}

export function toLinkSetVersionDto(v: LinkSetVersion): LinkSetVersionDto {
  return { id: v.id, code: v.code, isCurrent: v.isCurrent, currentPinned: v.currentPinned };
}

/**
 * 現在のバージョンを必ず1つに保つ。
 *
 * 利用者が選んでいれば（currentPinned）それに従い、選んでいなければ
 * **コード順でいちばん新しいもの**を自動で現在にする。一覧の並び（コードの降順）と
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
      orderBy: { codeNormalized: "desc" },
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
  row: LinkVersionSource & { version: { code: string }; source: { code: string } },
  linkCount: number,
): LinkVersionSourceDto {
  return {
    id: row.id,
    versionId: row.versionId,
    versionCode: row.version.code,
    sourceId: row.sourceId,
    sourceCode: row.source.code,
    priority: row.priority,
    note: row.note,
    loadedAt: row.loadedAt?.toISOString() ?? null,
    linkCount,
  };
}
