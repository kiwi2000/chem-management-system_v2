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
 * サーバー側のテーマ解決。言語と同じ順序で決める。
 * ログインユーザーの設定 → Cookie → 既定（システムに合わせる）。
 *
 * 本人の設定を先に見る。Cookie は端末に1つしか無いので、
 * 共有のパソコンだと、先に使った人の Cookie が次の人にも当たってしまう。
 * Cookie を見るのは、まだログインしていないとき（ログイン画面）と、
 * 本人がまだ何も選んでいないときだけ。
 *
 * サーバーで決めてから描画するので、開いた直後に色が切り替わるちらつきは起きない。
 */
export async function getTheme(): Promise<Theme> {
  const user = await getSessionUser().catch(() => null);
  if (isTheme(user?.preferredTheme)) return user.preferredTheme;

  const fromCookie = (await cookies()).get(THEME_COOKIE)?.value;
  if (isTheme(fromCookie)) return fromCookie;

  return DEFAULT_THEME;
}

/**
 * 「ヘッダーなどを濃くする」の解決。テーマと同じ順序（本人の設定 → Cookie → 既定=しない）。
 * テーマとは独立した設定なので、どの配色でも入切できる。
 */
export async function getHeaderStrong(): Promise<boolean> {
  const user = await getSessionUser().catch(() => null);
  if (typeof user?.preferredHeaderStrong === "boolean") return user.preferredHeaderStrong;

  const fromCookie = (await cookies()).get(HEADER_STRONG_COOKIE)?.value;
  if (fromCookie === "1") return true;
  if (fromCookie === "0") return false;

  return false;
}

/** 背景の模様・挿絵。テーマと同じ順序（本人の設定 → Cookie → 既定=なし） */
export async function getBackground(): Promise<Background> {
  const user = await getSessionUser().catch(() => null);
  if (isBackground(user?.preferredBackground)) return user.preferredBackground;

  const fromCookie = (await cookies()).get(BACKGROUND_COOKIE)?.value;
  if (isBackground(fromCookie)) return fromCookie;

  return DEFAULT_BACKGROUND;
}
