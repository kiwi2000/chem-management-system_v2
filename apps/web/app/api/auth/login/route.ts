import { headers } from "next/headers";
import { loginSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { login, purgeExpiredSessions } from "@/lib/auth";
import { jsonError } from "@/lib/authz";
import { syncPreferenceCookies } from "@/lib/preference-cookies";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — ログイン。
 * 失敗理由は原則ひとまとめの文言にし、アカウントの存在を推測させない。
 * （authz を通さない数少ないルート。呼び忘れ検出テストの allowlist に入っている）
 */
export async function POST(req: Request) {
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = loginSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { email, password, totp } = parsed.data;

  const result = await login(email, password, totp);

  if (!result.ok) {
    if (result.reason === "mfa_required") {
      // 多要素認証のコード待ち（パスワードは正しい）
      return Response.json({ mfaRequired: true }, { status: 401 });
    }
    if (result.reason === "mfa_invalid") {
      return jsonError(401, "mfa_invalid", m.errors.mfaInvalid, { mfaRequired: true });
    }
    if (result.reason === "locked") {
      return jsonError(423, "locked", m.errors.locked);
    }
    /*
      **止められているアカウントも、ただの「合いません」で返す。**
      ここだけ別の文言・別のコードにすると、そのアドレスが実在することが
      外から分かってしまう（当たったアドレスだけ反応が変わる）。
      止められていることは、記録には理由付きで残っているので管理者は追える
    */
    return jsonError(401, "invalid_credentials", m.errors.invalidCredentials);
  }

  void purgeExpiredSessions();
  // 前に使った人の Cookie が残っていることがあるので、この人のものに入れ替える
  await syncPreferenceCookies(result.user);
  // 成功も、どこから入ったかまで残す。失敗の記録と突き合わせて見るため
  const hdrs = await headers();
  await writeAudit({
    entity: "users",
    entityId: result.user.id,
    action: "login",
    actorId: result.user.id,
    diff: {
      email: result.user.email,
      ip: hdrs.get("x-forwarded-for") ?? null,
      userAgent: hdrs.get("user-agent")?.slice(0, 200) ?? null,
    },
  });
  return Response.json({ ok: true, mustChangePassword: result.mustChangePassword });
}
