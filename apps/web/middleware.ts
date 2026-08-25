import { NextResponse, type NextRequest } from "next/server";
import { NONCE_HEADER, PATH_HEADER } from "@/lib/routes";

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

/**
 * 差し込まれた script を実行させないための決まり（CSP）。
 *
 * 要求ごとに使い捨ての印（nonce）を作り、その印が付いた script だけを許す。
 * 外から読み込んでいるものが一つも無いので、行き先はすべて自分自身に絞れる。
 *
 * `strict-dynamic` は「印の付いた script が読み込むものは許す」という意味。
 * Next.js は自分が出す script に、この印を自動で付ける。
 *
 * 見た目の指定（style）だけは緩めてある。表の列幅のように、
 * その場で組み立てる指定を使っているため。
 */
function contentSecurityPolicy(nonce: string) {
  // 開発中は Next.js が eval を使うので、そこだけ許す。本番では許さない
  const devScript = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

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

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, pathname);
  headers.set(NONCE_HEADER, nonce);
  // 要求側にも同じものを載せる。Next.js はこれを見て、自分の script に印を付ける
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // 静的アセットと API を除くすべてのページ
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico).*)"],
};
