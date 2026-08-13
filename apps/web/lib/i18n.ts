import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getMessages,
  isLocale,
  type Locale,
  type Messages,
} from "@chem/shared";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";

/**
 * サーバー側のロケール解決。
 * 優先順位は Cookie → ログインユーザーの設定 → 既定（日本語）。
 * Cookie を先に見るのは、ログイン前に選んだ言語をログイン画面でも保つため。
 * 言語の切替時は Cookie とユーザー設定の両方を更新するので、両者は基本的に一致する。
 */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const user = await getSessionUser().catch(() => null);
  if (isLocale(user?.preferredLocale)) return user.preferredLocale;

  return DEFAULT_LOCALE;
}

/** そのリクエストで使う文言一式（サーバーコンポーネント・API ルート用） */
export async function getServerMessages(): Promise<Messages> {
  return getMessages(await getLocale());
}
