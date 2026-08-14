import { DEFAULT_THEME, THEME_COOKIE, isTheme, type Theme } from "@chem/shared";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";

/**
 * サーバー側のテーマ解決。言語と同じ順序で決める。
 * Cookie → ログインユーザーの設定 → 既定（システムに合わせる）。
 *
 * サーバーで決めてから描画するので、開いた直後に色が切り替わるちらつきは起きない。
 */
export async function getTheme(): Promise<Theme> {
  const fromCookie = (await cookies()).get(THEME_COOKIE)?.value;
  if (isTheme(fromCookie)) return fromCookie;

  const user = await getSessionUser().catch(() => null);
  if (isTheme(user?.preferredTheme)) return user.preferredTheme;

  return DEFAULT_THEME;
}
