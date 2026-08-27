import { EMPTY_DOCUMENT, parseDocumentContent, unknownFields } from "@chem/shared";
import type { DocumentContent, DocumentTarget } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { DocumentTemplateDto } from "@/lib/types";

/**
 * ドキュメント生成のテンプレートの共通処理。
 *
 * **中身（ブロックの並び）は、読めるか確かめてから渡す。**
 * `content` は Json なので、古い形のまま残っていることがありうる。
 * そのまま画面へ流すと、編集画面が壊れた見えかたをする。
 */

export const DOC_TEMPLATE_SELECT = {
  id: true,
  code: true,
  nameJa: true,
  nameEn: true,
  target: true,
  content: true,
  locale: true,
  active: true,
  seq: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentTemplateSelect;

type Row = Prisma.DocumentTemplateGetPayload<{ select: typeof DOC_TEMPLATE_SELECT }>;

/**
 * 画面に渡す形へ。
 *
 * **読めない中身は空として渡し、そのことを印で伝える。**
 * 黙って空にすると「開いたら消えていた」に見えるので、
 * 画面の側で断りを出せるようにする。
 */
export function toDocTemplateDto(row: Row): DocumentTemplateDto {
  const parsed = parseDocumentContent(row.content);
  const content = parsed ?? EMPTY_DOCUMENT;
  return {
    id: row.id,
    code: row.code,
    nameJa: row.nameJa,
    nameEn: row.nameEn,
    target: row.target,
    content,
    contentBroken: parsed === null,
    /** 対象に合わない差込項目。対象を変えたあとに気づけるようにする */
    unknownFields: unknownFields(content, row.target),
    blockCount: content.blocks.length,
    locale: row.locale,
    active: row.active,
    seq: row.seq,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 新しく作るときの中身。空の縦置き1枚 */
export function emptyContent(): DocumentContent {
  return { ...EMPTY_DOCUMENT, blocks: [] };
}

/** 対象を変えたときに、合わなくなる差込項目があるか */
export function fieldsBroken(content: DocumentContent, target: DocumentTarget): string[] {
  return unknownFields(content, target);
}
