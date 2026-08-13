import { en } from "./en";
import { ja, type Messages } from "./ja";
import { DEFAULT_LOCALE, type Locale } from "./locales";

export type { Messages };
export * from "./locales";

const CATALOGS: Record<Locale, Messages> = { ja, en };

/**
 * その言語の文言一式を返す。
 * 文言はキーで引くのではなくオブジェクトを辿って使う（例: `m.login.submit`）。
 * こうすると綴り間違いと訳の抜けをビルド時に検出できる。
 */
export function getMessages(locale: Locale | null | undefined): Messages {
  return CATALOGS[locale ?? DEFAULT_LOCALE] ?? CATALOGS[DEFAULT_LOCALE];
}
