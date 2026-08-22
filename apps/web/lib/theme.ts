import {
  BACKGROUND_COOKIE,
  DEFAULT_BACKGROUND,
  DEFAULT_THEME,
  HEADER_STRONG_COOKIE,
  THEME_COOKIE,
  isBackground,
  isTheme,
  type Background,
  type Theme,
} from "@chem/shared";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";

/**
 * サーバー側のテーマ解決。言語と同じ決め方をする。
 *
 * ログインしていれば、見るのは<本人の設定だけ>。選んでいなければ既定に落とす。
 * Cookie は端末に1つしか無いので、前に使った人の値が残っている。
 * そこへ落ちると、まだ何も選んでいない人に前の人の配色が当たってしまう
 * （1台のスマホで人を入れ替えると、これが起きた）。
 *
 * Cookie を見るのは、ログインしていないときだけ。ログイン画面の配色を保つため。
 *
 * サーバーで決めてから描画するので、開いた直後に色が切り替わるちらつきは起きない。
 */
export async function getTheme(): Promise<Theme> {
  const user = await getSessionUser().catch(() => null);
  if (user) return isTheme(user.preferredTheme) ? user.preferredTheme : DEFAULT_THEME;

  const fromCookie = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(fromCookie) ? fromCookie : DEFAULT_THEME;
}

/**
 * 「ヘッダーなどを濃くする」の解決。テーマと同じ決め方。
 * テーマとは独立した設定なので、どの配色でも入切できる。
 */
export async function getHeaderStrong(): Promise<boolean> {
  const user = await getSessionUser().catch(() => null);
  if (user) return user.preferredHeaderStrong ?? false;

  const fromCookie = (await cookies()).get(HEADER_STRONG_COOKIE)?.value;
  return fromCookie === "1";
}

/** 背景の模様・挿絵。テーマと同じ決め方 */
export async function getBackground(): Promise<Background> {
  const user = await getSessionUser().catch(() => null);
  if (user)
    return isBackground(user.preferredBackground) ? user.preferredBackground : DEFAULT_BACKGROUND;

  const fromCookie = (await cookies()).get(BACKGROUND_COOKIE)?.value;
  return isBackground(fromCookie) ? fromCookie : DEFAULT_BACKGROUND;
}
