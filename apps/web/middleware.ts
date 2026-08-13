import { NextResponse, type NextRequest } from "next/server";

/**
 * 画面の保護。
 * ここでは Cookie の有無だけを見る軽量チェックに留める。
 * 実際のセッション検証（DB照合・期限・無効化）は各ページ／API の getSessionUser() が行う
 * （middleware は Edge ランタイムで動くため DB に触れない）。
 */
const SESSION_COOKIE = "chem_session";

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isLoginPage = request.nextUrl.pathname.startsWith("/login");

  if (!hasSession && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // 静的アセットと API を除くすべてのページ
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico).*)"],
};
