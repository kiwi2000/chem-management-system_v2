import QRCode from "qrcode";
import { jsonError, requireUser } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/mfa/qr?uri=... — 認証アプリに読ませるQRコードを絵にする。
 *
 * 外部のQRコード生成サービスは使わない。鍵をよそへ渡すことになるため。
 * 絵はSVGで返し、画面にそのまま埋める。
 */
export async function GET(req: Request) {
  // 用事そのもの（2要素認証の登録）。ここを止めるとQRコードが出ず、登録を始められない
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  const m = await getServerMessages();

  const uri = new URL(req.url).searchParams.get("uri");
  // 自分の鍵しか絵にできないようにする。他人の文字列を渡されても描かない
  if (!uri || !uri.startsWith("otpauth://totp/")) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
  });
}
