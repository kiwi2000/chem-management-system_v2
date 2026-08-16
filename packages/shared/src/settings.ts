import { z } from "zod";
import { COMPOSITION_VALIDATION_MODES, type CompositionValidationMode } from "./composition";
import { toScaled } from "./decimal";
import type { Messages } from "./i18n/ja";

/**
 * システム設定。
 * 値は SystemSetting テーブルに文字列で入れ、ここで型付きに読み替える。
 * 設定を増やすときは AppSettings・DEFAULT_SETTINGS・SETTING_DEFS・settingsSchema の4か所を揃えること。
 */

export interface AppSettings {
  /** CAS番号を必須にする。false なら空欄で登録できる */
  casRequired: boolean;
  /** CAS番号の形（例: 7439-92-1）を強制する。false なら形が違っても警告だけで保存できる */
  casFormatEnforced: boolean;

  /** 組成の含有率合計をどのくらい厳しく見るか */
  compositionValidationMode: CompositionValidationMode;
  /** 合計を 100% と見なす許容誤差（%）。数値は文字列で持つ */
  compositionEpsilonPct: string;
  /** balance（残部）行を使えるようにするか */
  compositionBalanceAllowed: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  casRequired: false,
  casFormatEnforced: false,
  compositionValidationMode: "STANDARD",
  compositionEpsilonPct: "0.01",
  compositionBalanceAllowed: true,
};

/**
 * DB のキーと AppSettings の対応（値のハードコードを避けるため一元管理する）。
 * DB には文字列で入るので、読み書きの変換もここに持たせる。
 */
interface SettingDef<K extends keyof AppSettings = keyof AppSettings> {
  field: K;
  key: string;
  valueType: "BOOLEAN" | "STRING" | "NUMBER";
  /** DB の文字列 → 設定値。読めない値は既定にフォールバックさせるため null を返す */
  parse: (raw: string) => AppSettings[K] | null;
}

const boolDef = (field: keyof AppSettings, key: string): SettingDef => ({
  field,
  key,
  valueType: "BOOLEAN",
  parse: (raw) => (raw === "true" || raw === "false" ? raw === "true" : null),
});

export const SETTING_DEFS: SettingDef[] = [
  boolDef("casRequired", "substance.cas_required"),
  boolDef("casFormatEnforced", "substance.cas_format_enforced"),
  {
    field: "compositionValidationMode",
    key: "composition.validation_mode",
    valueType: "STRING",
    parse: (raw) =>
      (COMPOSITION_VALIDATION_MODES as readonly string[]).includes(raw)
        ? (raw as CompositionValidationMode)
        : null,
  },
  {
    field: "compositionEpsilonPct",
    key: "composition.epsilon_pct",
    valueType: "NUMBER",
    parse: (raw) => {
      const scaled = toScaled(raw);
      return scaled !== null && scaled >= 0n ? raw.trim() : null;
    },
  },
  boolDef("compositionBalanceAllowed", "composition.balance_allowed"),
];

/** 許容誤差は 0〜10%。これより大きい値は設定ミスとみなす */
const epsilonSchema = (m: Messages) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, m.validation.numberFormat)
    .refine((v) => {
      const scaled = toScaled(v);
      return scaled !== null && scaled <= 10n * 1000000n;
    }, m.settings.epsilonRange);

export const settingsSchema = (m: Messages) =>
  z.object({
    casRequired: z.boolean(),
    casFormatEnforced: z.boolean(),
    compositionValidationMode: z.enum(COMPOSITION_VALIDATION_MODES),
    compositionEpsilonPct: epsilonSchema(m),
    compositionBalanceAllowed: z.boolean(),
  });

export type SettingsInput = z.infer<ReturnType<typeof settingsSchema>>;
