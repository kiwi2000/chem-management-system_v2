import { pickPasswordPolicy } from "@chem/shared";
import { requireUser } from "@/lib/authz";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/password-policy — パスワードの決まりだけを返す。
 *
 * システム設定は管理者しか読めないが、決まりは自分のパスワードを変える人にも要る。
 * 返すのは長さと文字種だけで、他の設定は含めない。
 */
export async function GET() {
  // パスワードの決まりを見せるだけ。初期パスワードの変更画面が使う
  const actor = await requireUser({ allowPending: true });
  if (actor instanceof Response) return actor;

  const settings = await getAppSettings();
  return Response.json({ policy: pickPasswordPolicy(settings) });
}
