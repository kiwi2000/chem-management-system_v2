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
 * Cookie は端末に1つ、設定は人ごと。共有のパソコンで前の人の Cookie が残っていると、
 * ログアウトしたあとのログイン画面に前の人の配色が出たままになる。
 * 画面の見た目を決めるのは本人の設定（lib/theme.ts）なので、
 * これは、ログインしていない画面のための後始末。
 *
 * 本人がまだ何も選んでいない項目には触らない。ログイン画面で選んだ言語を消さないため。
 */
export async function syncPreferenceCookies(user: Preferences): Promise<void> {
  const store = await cookies();
  if (isLocale(user.preferredLocale)) {
    store.set(LOCALE_COOKIE, user.preferredLocale, PREFERENCE_COOKIE_OPTIONS);
  }
  if (isTheme(user.preferredTheme)) {
    store.set(THEME_COOKIE, user.preferredTheme, PREFERENCE_COOKIE_OPTIONS);
  }
  if (typeof user.preferredHeaderStrong === "boolean") {
    store.set(
      HEADER_STRONG_COOKIE,
      user.preferredHeaderStrong ? "1" : "0",
      PREFERENCE_COOKIE_OPTIONS,
    );
  }
  if (isBackground(user.preferredBackground)) {
    store.set(BACKGROUND_COOKIE, user.preferredBackground, PREFERENCE_COOKIE_OPTIONS);
  }
}
