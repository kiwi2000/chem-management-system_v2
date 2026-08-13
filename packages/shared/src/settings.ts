import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * システム設定。
 * 値は SystemSetting テーブルに文字列で入れ、ここで型付きに読み替える。
 * 設定を増やすときは SETTING_DEFS・AppSettings・settingsSchema の3か所を揃えること。
 */

export interface AppSettings {
  /** CAS番号を必須にする。false なら空欄で登録できる */
  casRequired: boolean;
  /** CAS番号の形（例: 7439-92-1）を強制する。false なら形が違っても警告だけで保存できる */
  casFormatEnforced: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  casRequired: false,
  casFormatEnforced: false,
};

/** DB のキーと AppSettings の対応（値のハードコードを避けるため一元管理する） */
export const SETTING_DEFS: {
  field: keyof AppSettings;
  key: string;
  valueType: "BOOLEAN";
}[] = [
  { field: "casRequired", key: "substance.cas_required", valueType: "BOOLEAN" },
  { field: "casFormatEnforced", key: "substance.cas_format_enforced", valueType: "BOOLEAN" },
];

export const settingsSchema = (_m: Messages) =>
  z.object({
    casRequired: z.boolean(),
    casFormatEnforced: z.boolean(),
  });

export type SettingsInput = z.infer<ReturnType<typeof settingsSchema>>;
