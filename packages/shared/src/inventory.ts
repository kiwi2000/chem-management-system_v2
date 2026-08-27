import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * インベントリ（各国の既存化学物質の目録）。
 *
 * インベントリそのものは、国とコードと名前を持つだけの入れ物。
 * 中身（CASと番号の対応）は行の側が持ち、**バージョンとデータソースごとに分かれる**。
 *
 * 番号として物質の画面に出すかどうかは、呼び名とは別の印で持つ。
 * 出すのをやめても呼び名を残せるようにするため。
 */
export const inventorySchema = (m: Messages) =>
  z.object({
    nameJa: z.string().trim().max(200, m.validation.tooLong(200)).nullish(),
    nameEn: z.string().trim().max(200, m.validation.tooLong(200)).nullish(),
    /** 番号としての呼び名。空なら出せない */
    numberLabel: z.string().trim().max(100, m.validation.tooLong(100)).nullish(),
    numberOrder: z.number().int().min(0).max(9999),
    numberShown: z.boolean(),
  });

export type InventoryInput = z.infer<ReturnType<typeof inventorySchema>>;

/**
 * インベントリの1行。
 *
 * 値は**仕上がったもの**を入れる。番号（`(5)-3714`）か、
 * 番号を持たないインベントリの「該当」のような固定の文字。
 * 取り出し（正規表現）は取り込みスクリプトが受け持つので、ここでは形を問わない。
 *
 * **どのデータソースのものかを必ず選ばせる。**同じインベントリを別々のところから
 * 取れるので、どれとして入れたのかが決まらないと優先度を解けない。
 * バージョンは現在のバージョンに決め打つ（過去のバージョンは取り込んだ姿のまま残す）。
 */
export const inventoryRowSchema = (m: Messages) =>
  z.object({
    sourceId: z.string().trim().min(1, m.validation.required),
    /** インベントリはCASで引くものなので、システム設定に関係なく必須 */
    casNumber: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    value: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
  });

export type InventoryRowInput = z.infer<ReturnType<typeof inventoryRowSchema>>;
