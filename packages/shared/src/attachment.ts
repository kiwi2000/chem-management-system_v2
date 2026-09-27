import { z } from "zod";

/**
 * 製品・原材料の添付ファイル（2026-09-27 指示）。画面・API で共用する決まり。
 */

/**
 * 種類の選択肢の**既定**。実際の選択肢はシステム設定で決める（2026-09-27 指示）
 */
export const ATTACHMENT_KINDS_DEFAULT = ["SDS", "試験成績書", "調査回答", "図面", "その他"];

/**
 * 1 ファイルの上限（MB）。**システム設定で変えられる**（2026-09-27 指示）。
 * 中身は DB に置くので、上げすぎると DB とバックアップが太る。範囲はその歯止め
 */
export const ATTACHMENT_MAX_MB_DEFAULT = 20;
export const ATTACHMENT_MAX_MB_MIN = 1;
export const ATTACHMENT_MAX_MB_MAX = 100;

/**
 * 受け付ける拡張子の**既定**。PDF・Word・Excel・画像・テキスト。
 * 実際に受け付ける拡張子はシステム設定で決める（2026-09-27 指示。空欄ならすべて）。
 * マクロ付きは、拡張子の設定とは別に、既定では受け付けない（開いた人の機械で何でも動いてしまうため）
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

/**
 * ブラウザがそのまま見せられる形式（プレビューできるもの）。PDF・画像・テキスト（2026-09-27 指示）。
 * Word・Excel はブラウザだけでは見られない（外のサービスに頼らない方針）のでダウンロードになる
 */
const PREVIEWABLE_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "text/plain",
  "text/csv",
]);
export function isPreviewable(mime: string): boolean {
  return PREVIEWABLE_MIMES.has(mime);
}

/**
 * マクロ付きの Office の拡張子。「マクロ付きのファイルを受け付ける」を入れたときだけ受け付ける。
 * **許す拡張子に挙がっていても、マクロを許していなければ断る**
 */
export const ATTACHMENT_MACRO_EXTENSIONS = [
  "docm",
  "dotm",
  "xlsm",
  "xltm",
  "xlsb",
  "xlam",
  "pptm",
  "potm",
  "ppsm",
] as const;

/** 拡張子の書きかた（英数字 1〜10 字。点は付けない） */
export const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/;

/**
 * 許す拡張子の欄を読む。区切りは読点・カンマ・空白・改行のどれでもよい。
 * 頭の点は落とし、小文字にそろえ、重ねて書いたものは 1 つにする。空なら空の並び（＝すべて許す）
 */
export function parseExtensionList(raw: string): string[] {
  const out: string[] = [];
  for (const t of raw.split(/[\s,、，]+/)) {
    const v = t.trim().replace(/^\.+/, "").toLowerCase();
    if (v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}

export const formatExtensionList = (exts: readonly string[]): string => exts.join(", ");

/**
 * ファイル選びの窓に渡す accept。許す拡張子で絞る。
 * 空（すべて許す）なら絞らない。マクロを許していなければ、マクロ付きの拡張子は外す
 */
export function attachmentAccept(extensions: readonly string[], allowMacros: boolean): string {
  if (extensions.length === 0) return "";
  const macro: readonly string[] = ATTACHMENT_MACRO_EXTENSIONS;
  return extensions
    .filter((e) => allowMacros || !macro.includes(e))
    .map((e) => `.${e}`)
    .join(",");
}

/**
 * 件名・種類・説明。追加（ファイルと一緒に）と書き換えで同じ決まりを使う。
 * 種類が選択肢にあるかはサーバーがシステム設定と突き合わせる
 */
export const attachmentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(255),
  // 種類も必須（2026-09-27 指示）。値はシステム設定の選択肢から
  kind: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type AttachmentFieldsInput = z.infer<typeof attachmentFieldsSchema>;
