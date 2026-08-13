import { LOCALE_COOKIE, isLocale } from "@chem/shared";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * PUT /api/locale — 表示言語の切替。
 * ログイン前でも使える（ログイン画面の言語を選べるようにするため）ので認証は必須にしない。
 * 副作用は Cookie と、ログイン中なら自分の設定のみ。業務データには触れない。
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const m = await getServerMessages();
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }

  const locale = (body as { locale?: unknown } | null)?.locale;
  if (!isLocale(locale)) {
    const m = await getServerMessages();
    return jsonError(400, "validation_error", m.errors.validation);
  }

  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: false, // 言語は機密ではない。将来クライアント側から読めると都合が良い
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  const user = await getSessionUser().catch(() => null);
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: locale } });
  }

  return Response.json({ ok: true, locale });
}
