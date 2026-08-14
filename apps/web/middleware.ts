import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/lib/routes";

/**
 * 画面の保護。
 * ここでは Cookie の有無だけを見る軽量チェックに留める。
 * 実際のセッション検証（DB照合・期限・無効化）は各ページ／API の getSessionUser() が行う
 * （middleware は Edge ランタイムで動くため DB に触れない）。
 *
 * Cookie は残っているがセッションが無効、という状態があり得る
 * （管理者による無効化・権限変更・期限切れ）。これは components/app-shell.tsx で拾い、
 * `/login?expired=1` へ送る。そのときここで「/」へ送り返すと堂々巡りになるので、
 * expired が付いているログイン画面だけは Cookie があっても通す。
 */
const SESSION_COOKIE = "chem_session";

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isLoginPage = pathname.startsWith("/login");

  if (!hasSession && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && isLoginPage && searchParams.get("expired") !== "1") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // 静的アセットと API を除くすべてのページ
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico).*)"],
};
