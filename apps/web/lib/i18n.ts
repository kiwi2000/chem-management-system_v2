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
 *
 * ログインしていれば、見るのは<本人の設定だけ>。選んでいなければ既定（日本語）に落とす。
 * Cookie は端末に1つしか無いので、前に使った人の値が残っている。
 * そこへ落ちると、まだ何も選んでいない人に前の人の言語が当たってしまう。
 *
 * Cookie を見るのは、ログインしていないときだけ。ログイン画面で選んだ言語を保つため。
 */
export async function getLocale(): Promise<Locale> {
  const user = await getSessionUser().catch(() => null);
  if (user) return isLocale(user.preferredLocale) ? user.preferredLocale : DEFAULT_LOCALE;

  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
}

/** そのリクエストで使う文言一式（サーバーコンポーネント・API ルート用） */
export async function getServerMessages(): Promise<Messages> {
  return getMessages(await getLocale());
}
