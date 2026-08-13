import { changePasswordSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { createSession, hashPassword, revokeAllSessions, verifyPassword } from "@/lib/auth";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password — 自分のパスワード変更。
 * 変更後は全セッションを失効させ（他端末の乗っ取り対策）、自分だけ再発行する。
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "リクエストボディがJSONではありません");
  }
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", "入力内容に誤りがあります", parsed.error.flatten());
  }
  const { currentPassword, newPassword } = parsed.data;

  if (!user.passwordHash) {
    return jsonError(
      400,
      "no_password",
      "パスワードが設定されていません。管理者にお問い合わせください",
    );
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    return jsonError(401, "invalid_credentials", "現在のパスワードが正しくありません");
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
