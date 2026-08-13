/** 対応言語。追加するときはここと辞書ファイルの両方を増やす */
export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ja";

/** 画面の言語切替に出す表示名（その言語自身の表記） */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

/** Cookie 名。ログイン前でも言語を選べるようにするため Cookie に持つ */
export const LOCALE_COOKIE = "chem_locale";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * 日本語名・英語名の2列を持つデータ（物質名・製品名など）から、表示する方を選ぶ。
 * 英語表示でも英語名が未登録なら日本語名にフォールバックする（空欄にしない）。
 */
export function pickName(
  locale: Locale,
  nameJa: string | null | undefined,
  nameEn: string | null | undefined,
): string {
  if (locale === "en") return nameEn?.trim() || nameJa?.trim() || "";
  return nameJa?.trim() || nameEn?.trim() || "";
}
