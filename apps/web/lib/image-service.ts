import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ImageAssetDto } from "@/lib/types";

/**
 * 画像ライブラリ（2026-09-16 指示）。
 * どのテンプレートで使われているかは、テンプレートの中身（JSON）に画像の id が書いてあるかで数える
 * （画像ブロックは `imageId` で参照する）。表を分けて持つと、テンプレートを直すたびに同期が要る
 */

export const IMAGE_SELECT = {
  id: true,
  name: true,
  note: true,
  mime: true,
  width: true,
  height: true,
  size: true,
  createdAt: true,
} satisfies Prisma.ImageAssetSelect;

type ImageRow = Prisma.ImageAssetGetPayload<{ select: typeof IMAGE_SELECT }>;

/** 画像を使っているテンプレート（消されていないものだけ）。画面でコードを押して編集へ移れるように */
export interface ImageUsage {
  id: string;
  code: string;
  nameJa: string;
}

export async function usageOf(ids: string[]): Promise<Map<string, ImageUsage[]>> {
  const out = new Map<string, ImageUsage[]>();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw<
    { image_id: string; id: string; code: string; name_ja: string }[]
  >`
    SELECT i.id AS image_id, t.id, t.code, t.name_ja
    FROM unnest(${ids}::text[]) AS i(id)
    JOIN document_templates t
      ON t.deleted_at IS NULL
     -- jsonb を文字にすると「"imageId": "…"」のようにコロンの後に空白が入る。入らない書きかたも拾う
     AND t.content::text ~ ('"imageId":\\s*"' || i.id || '"')
    ORDER BY t.code`;
  for (const r of rows) {
    const list = out.get(r.image_id) ?? [];
    list.push({ id: r.id, code: r.code, nameJa: r.name_ja });
    out.set(r.image_id, list);
  }
  return out;
}

export function toImageDto(r: ImageRow, usedBy: ImageUsage[]): ImageAssetDto {
  return {
    id: r.id,
    name: r.name,
    note: r.note,
    mime: r.mime,
    width: r.width,
    height: r.height,
    size: r.size,
    usedBy,
    createdAt: r.createdAt.toISOString(),
  };
}

/** 画像の中身を data: URL に（印刷用ページで使う。ログインの Cookie を持たないブラウザが読むため） */
export async function imageDataUrls(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const rows = await prisma.imageAsset.findMany({
    where: { id: { in: unique } },
    select: { id: true, mime: true, data: true },
  });
  return Object.fromEntries(
    rows.map((r) => [r.id, `data:${r.mime};base64,${Buffer.from(r.data).toString("base64")}`]),
  );
}
