/** 定数・正規化ユーティリティ（循環importを避けるため index から分離） */

/** 含有率合計の検証モード（Q-D5確定・SystemSetting で管理者が切替） */
export const COMPOSITION_VALIDATION_MODES = ["STRICT", "STANDARD", "LENIENT"] as const;
export type CompositionValidationMode = (typeof COMPOSITION_VALIDATION_MODES)[number];

/** SystemSetting のキー（値のハードコード禁止: CLAUDE.md §8） */
export const SETTING_KEYS = {
  compositionValidationMode: "composition.validation_mode",
  compositionEpsilon: "composition.epsilon",
  compositionBalanceAllowed: "composition.balance_allowed",
} as const;

/** SystemSetting の既定値（DB未設定時のフォールバック） */
export const SETTING_DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.compositionValidationMode]: "STANDARD",
  [SETTING_KEYS.compositionEpsilon]: "0.01",
  [SETTING_KEYS.compositionBalanceAllowed]: "true",
};

/**
 * コード・CAS番号の正規化（trim＋大文字化）。
 * DB照合順序差（PG=区別 / MySQL・SQL Server=非区別）を吸収するため、
 * 突合・一意判定は必ず正規化値で行う（CLAUDE.md §3 / data-model.md §1.1）。
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}
