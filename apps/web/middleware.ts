import { NextResponse, type NextRequest } from "next/server";
import { clientIp, ipVerdict, parseAllowList } from "@/lib/ip-allow";
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

/**
 * 決まった場所からだけ入れるようにする。
 *
 * 許可する相手は `ALLOWED_IPS`（環境変数）で渡す。**空なら制限しない。**
 * 設定を誤って全員が締め出されたとき、値を消せば必ず戻れるようにするための安全弁。
 *
 * `IP_FILTER_MODE` で強さを変える。
 *
 *   monitor（既定）… 断らない。許可外から来たことを記録に残すだけ
 *   enforce … 許可外を断る
 *
 * まず monitor でしばらく動かし、正しい利用者のアドレスが記録に出そろって
 * いることを見てから enforce に切り替える。いきなり弾くと、把握できていない
 * 場所から使っている人を締め出す。
 *
 * 記録は Railway の実行記録（ログ）に出す。middleware は Edge で動くので
 * データベースに触れないため。
 */
function checkIp(request: NextRequest, pathname: string): NextResponse | null {
  const allowList = parseAllowList(process.env.ALLOWED_IPS);
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  if (ipVerdict(ip, allowList) !== "deny") return null;

  const enforce = process.env.IP_FILTER_MODE === "enforce";
  if (shouldLog(ip)) {
    // 異常ではないので warn にしない（記録の側で「エラー」として扱われてしまう）。
    // 消し忘れの debug 出力ではなく、運用のための記録なのでここだけ許す
    // eslint-disable-next-line no-console
    console.log(
      `[ip-filter] ${enforce ? "断りました" : "様子見（通しました）"} ip=${ip ?? "不明"} path=${pathname}`,
    );
  }
  if (!enforce) return null;
  // 何があるのかを外へ伝えない。ここにシステムがあること自体を悟らせない
  return new NextResponse("Not Found", { status: 404 });
}

/**
 * 同じ相手を何度も書かない。
 *
 * 画面を1つ開くだけで裏の問い合わせが何本も飛ぶので、素直に書くと
 * 記録が同じ行で埋まり、肝心の「他にどこから来ているか」が見えなくなる。
 * ここは「どの場所から使われているか」を集めるための記録なので、相手ごとに1回でよい。
 *
 * 覚えておくのは動いているあいだだけ。入れ替わればまた1回書く（それで困らない）。
 */
const logged = new Set<string>();
function shouldLog(ip: string | null): boolean {
  const key = ip ?? "不明";
  if (logged.has(key)) return false;
  // 際限なく増やさない。増えすぎたら忘れて数え直す
  if (logged.size > 500) logged.clear();
  logged.add(key);
  return true;
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const blocked = checkIp(request, pathname);
  if (blocked) return blocked;

  /*
    API はここから先の処理をしない。
    未ログインでもログイン画面へ飛ばさず、各 API が 401 を返せるようにするため
    （飛ばすと、JSON を待っている画面側に HTML が返る）。
    認可は各 API の getSessionUser() が見ている。
  */
  if (pathname.startsWith("/api/")) return NextResponse.next();
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
  /*
    静的な部品を除くすべて。**API も通す**（接続元の判定を効かせるため）。
    稼働確認だけは、外の監視から叩けるように外しておく。
  */
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/health).*)"],
};
