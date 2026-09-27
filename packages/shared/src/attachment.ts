import { z } from "zod";

/**
 * 製品・原材料の添付ファイル（2026-09-27 指示）。画面・API で共用する決まり。
 */

/** 種類。DB の AttachmentKind と同じ並び */
export const ATTACHMENT_KINDS = ["SDS", "TEST_REPORT", "SURVEY", "DRAWING", "OTHER"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * 1 ファイルの上限（MB）。**システム設定で変えられる**（2026-09-27 指示）。
 * 中身は DB に置くので、上げすぎると DB とバックアップが太る。範囲はその歯止め
 */
export const ATTACHMENT_MAX_MB_DEFAULT = 20;
export const ATTACHMENT_MAX_MB_MIN = 1;
export const ATTACHMENT_MAX_MB_MAX = 100;

/**
 * 受け付ける拡張子。PDF・Word・Excel・画像・テキスト。
 * マクロ付きは既定では受け付けない（開いた人の機械で何でも動いてしまうため）。
 * システム設定で許したときだけ、下の MACRO の拡張子と、マクロ入りの中身を受け付ける
 */
export const ATTACHMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
] as const;

/** マクロ付きの Office の拡張子。システム設定で許したときだけ受け付ける */
export const ATTACHMENT_MACRO_EXTENSIONS = ["docm", "xlsm"] as const;

/** ファイル選びの窓に渡す accept。拡張子で絞る */
export function attachmentAccept(allowMacros: boolean): string {
  const exts: readonly string[] = allowMacros
    ? [...ATTACHMENT_EXTENSIONS, ...ATTACHMENT_MACRO_EXTENSIONS]
    : ATTACHMENT_EXTENSIONS;
  return exts.map((e) => `.${e}`).join(",");
}

/** 種類・備考・「組成を見られる人だけ」の書き換え */
export const attachmentUpdateSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  compositionOnly: z.boolean().optional(),
});
export type AttachmentUpdateInput = z.infer<typeof attachmentUpdateSchema>;
