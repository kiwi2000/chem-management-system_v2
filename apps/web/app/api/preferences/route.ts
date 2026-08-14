import { LOCALE_COOKIE, THEME_COOKIE, isLocale, isTheme } from "@chem/shared";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

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
  const { locale, theme } = (body ?? {}) as { locale?: unknown; theme?: unknown };

  if (locale !== undefined && !isLocale(locale)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (theme !== undefined && !isTheme(theme)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const store = await cookies();
  const cookieOptions = {
    // 言語もテーマも機密ではない。将来クライアント側から読めると都合が良い
    httpOnly: false,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
  if (isLocale(locale)) store.set(LOCALE_COOKIE, locale, cookieOptions);
  if (isTheme(theme)) store.set(THEME_COOKIE, theme, cookieOptions);

  const user = await getSessionUser().catch(() => null);
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(isLocale(locale) ? { preferredLocale: locale } : {}),
        ...(isTheme(theme) ? { preferredTheme: theme } : {}),
      },
    });
  }

  return Response.json({ ok: true, locale, theme });
}
