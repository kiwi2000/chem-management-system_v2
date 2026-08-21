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
 * 優先順位は ログインユーザーの設定 → Cookie → 既定（日本語）。
 *
 * 本人の設定を先に見る。Cookie は端末に1つしか無いので、共有のパソコンだと
 * 先に使った人の言語が次の人にも当たってしまう。
 * Cookie を見るのは、まだログインしていないとき（ログイン画面で選んだ言語を保つため）と、
 * 本人がまだ何も選んでいないときだけ。
 */
export async function getLocale(): Promise<Locale> {
  const user = await getSessionUser().catch(() => null);
  if (isLocale(user?.preferredLocale)) return user.preferredLocale;

  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  return DEFAULT_LOCALE;
}

/** そのリクエストで使う文言一式（サーバーコンポーネント・API ルート用） */
export async function getServerMessages(): Promise<Messages> {
  return getMessages(await getLocale());
}
