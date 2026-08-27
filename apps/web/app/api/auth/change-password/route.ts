import { changePasswordSchema, pickPasswordPolicy } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { getAppSettings } from "@/lib/settings";
import { createSession, hashPassword, revokeAllSessions, verifyPassword } from "@/lib/auth";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password — 自分のパスワード変更。
 * 変更後は全セッションを失効させ（他端末の乗っ取り対策）、自分だけ再発行する。
 */
export async function POST(req: Request) {
  // 用事そのもの（初期パスワードの変更）
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = changePasswordSchema(m, pickPasswordPolicy(await getAppSettings())).safeParse(
    body,
  );
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { currentPassword, newPassword } = parsed.data;

  if (!user.passwordHash) {
    return jsonError(400, "no_password", m.errors.noPassword);
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    return jsonError(401, "invalid_credentials", m.errors.currentPasswordWrong);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessions(user.id); // 全端末を強制ログアウト
  await createSession(user.id); // 自分は継続

  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "update",
    actorId: user.id,
    diff: { passwordChanged: true },
  });
  return Response.json({ ok: true });
}
