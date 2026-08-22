import {
  BACKGROUND_COOKIE,
  HEADER_STRONG_COOKIE,
  LOCALE_COOKIE,
  THEME_COOKIE,
  isBackground,
  isLocale,
  isTheme,
} from "@chem/shared";
import type { User } from "@prisma/client";
import { cookies } from "next/headers";

/** 言語もテーマも機密ではない。将来クライアント側から読めると都合が良い */
export const PREFERENCE_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

type Preferences = Pick<
  User,
  "preferredLocale" | "preferredTheme" | "preferredHeaderStrong" | "preferredBackground"
>;

/**
 * ログインした人の設定を Cookie に写す。
 *
 * Cookie は端末に1つ、設定は人ごと。1台のスマホで人が入れ替わると、
 * 前の人の Cookie が残ったままになる。
 *
 * 画面の見た目を決めるのは本人の設定だけ（lib/theme.ts はログイン中に Cookie を見ない）。
 * これは、ログアウトしたあとのログイン画面のための後始末。
 *
 * **選んでいない項目は消す。**残しておくと、次にログアウトしたときに
 * 前の人の配色でログイン画面が出る。
 */
export async function syncPreferenceCookies(user: Preferences): Promise<void> {
  const store = await cookies();
  const put = (name: string, value: string | null) => {
    if (value === null) store.delete(name);
    else store.set(name, value, PREFERENCE_COOKIE_OPTIONS);
  };

  put(LOCALE_COOKIE, isLocale(user.preferredLocale) ? user.preferredLocale : null);
  put(THEME_COOKIE, isTheme(user.preferredTheme) ? user.preferredTheme : null);
  put(
    HEADER_STRONG_COOKIE,
    typeof user.preferredHeaderStrong === "boolean"
      ? user.preferredHeaderStrong
        ? "1"
        : "0"
      : null,
  );
  put(BACKGROUND_COOKIE, isBackground(user.preferredBackground) ? user.preferredBackground : null);
}
