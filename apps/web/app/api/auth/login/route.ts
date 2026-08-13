import { loginSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { login, purgeExpiredSessions } from "@/lib/auth";
import { jsonError } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — ログイン。
 * 失敗理由は原則ひとまとめの文言にし、アカウントの存在を推測させない。
 * （authz を通さない数少ないルート。呼び忘れ検出テストの allowlist に入っている）
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "リクエストボディがJSONではありません");
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", "入力内容に誤りがあります", parsed.error.flatten());
  }
  const { email, password, totp } = parsed.data;

  const result = await login(email, password, totp);

  if (!result.ok) {
    if (result.reason === "mfa_required") {
      // 多要素認証のコード待ち（パスワードは正しい）
      return Response.json({ mfaRequired: true }, { status: 401 });
    }
    if (result.reason === "mfa_invalid") {
      return jsonError(401, "mfa_invalid", "認証コードが正しくありません", { mfaRequired: true });
    }
    if (result.reason === "locked") {
      return jsonError(
        423,
        "locked",
        "ログイン試行が続いたため一時的にロックされています。しばらく待ってから再試行してください",
      );
    }
    if (result.reason === "inactive") {
      return jsonError(
        403,
        "inactive",
        "このアカウントは利用できません。管理者にお問い合わせください",
      );
    }
    return jsonError(
      401,
      "invalid_credentials",
      "メールアドレスまたはパスワードが正しくありません",
    );
  }

  void purgeExpiredSessions();
  await writeAudit({
    entity: "users",
    entityId: result.user.id,
    action: "login",
    actorId: result.user.id,
    diff: { email: result.user.email },
  });
  return Response.json({ ok: true, mustChangePassword: result.mustChangePassword });
}
