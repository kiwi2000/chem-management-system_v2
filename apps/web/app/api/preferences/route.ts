import {
  BACKGROUND_COOKIE,
  HEADER_STRONG_COOKIE,
  LOCALE_COOKIE,
  THEME_COOKIE,
  isBackground,
  isLocale,
  isTheme,
} from "@chem/shared";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PREFERENCE_COOKIE_OPTIONS } from "@/lib/preference-cookies";

export const dynamic = "force-dynamic";

/** 管理者側のユーザー編集（packages/shared/src/admin.ts）と同じ上限に合わせる */
const DISPLAY_NAME_MAX = 200;

/**
 * PUT /api/preferences — 表示言語とテーマ（利用者ごとの設定）。
 *
 * ログイン前でも使える。ログイン画面で言語やテーマを選べる必要があるため。
 * 副作用は Cookie と、ログイン中なら自分の設定だけ。業務データには触れない。
 * （システム全体の設定は /api/settings で、そちらは管理者専用）
 */
export async function PUT(req: Request) {
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const { locale, theme, headerStrong, background, displayName } = (body ?? {}) as {
    locale?: unknown;
    theme?: unknown;
    headerStrong?: unknown;
    background?: unknown;
    displayName?: unknown;
  };

  if (locale !== undefined && !isLocale(locale)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (theme !== undefined && !isTheme(theme)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (headerStrong !== undefined && typeof headerStrong !== "boolean") {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (background !== undefined && !isBackground(background)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  // 表示名は空欄を認めない。前後の空白だけの入力も弾く
  let trimmedName: string | undefined;
  if (displayName !== undefined) {
    if (typeof displayName !== "string") {
      return jsonError(400, "validation_error", m.errors.validation);
    }
    trimmedName = displayName.trim();
    if (trimmedName.length === 0 || trimmedName.length > DISPLAY_NAME_MAX) {
      return jsonError(400, "validation_error", m.errors.displayNameRequired);
    }
  }

  const store = await cookies();
  const cookieOptions = PREFERENCE_COOKIE_OPTIONS;
  if (isLocale(locale)) store.set(LOCALE_COOKIE, locale, cookieOptions);
  if (isTheme(theme)) store.set(THEME_COOKIE, theme, cookieOptions);
  if (typeof headerStrong === "boolean") {
    store.set(HEADER_STRONG_COOKIE, headerStrong ? "1" : "0", cookieOptions);
  }
  if (isBackground(background)) store.set(BACKGROUND_COOKIE, background, cookieOptions);

  const user = await getSessionUser().catch(() => null);
  // 表示名は本人のアカウントを書き換えるので、ログインしていないと変更できない
  if (trimmedName !== undefined && !user) {
    return jsonError(401, "unauthorized", m.errors.unauthorized);
  }
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(isLocale(locale) ? { preferredLocale: locale } : {}),
        ...(isTheme(theme) ? { preferredTheme: theme } : {}),
        ...(typeof headerStrong === "boolean" ? { preferredHeaderStrong: headerStrong } : {}),
        ...(isBackground(background) ? { preferredBackground: background } : {}),
        ...(trimmedName !== undefined ? { displayName: trimmedName } : {}),
      },
    });
  }

  return Response.json({
    ok: true,
    locale,
    theme,
    headerStrong,
    background,
    displayName: trimmedName,
  });
}
