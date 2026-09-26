import { z } from "zod";

/**
 * 製品・原材料の添付ファイル（2026-09-27 指示）。画面・API で共用する決まり。
 */

/** 種類。DB の AttachmentKind と同じ並び */
export const ATTACHMENT_KINDS = ["SDS", "TEST_REPORT", "SURVEY", "DRAWING", "OTHER"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** 1 ファイルの上限（バイト）。仕入先の SDS・試験成績書は数 MB で収まる */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 受け付ける拡張子。PDF・Word・Excel・画像・テキスト。
 * **マクロ付き（.docm / .xlsm / .xlsb など）は受け付けない。**開いた人の機械で何でも動いてしまうため
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

/** ファイル選びの窓に渡す accept。拡張子で絞る */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

/** 種類・備考・「組成を見られる人だけ」の書き換え */
export const attachmentUpdateSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  compositionOnly: z.boolean().optional(),
});
export type AttachmentUpdateInput = z.infer<typeof attachmentUpdateSchema>;
