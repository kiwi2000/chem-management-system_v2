import { passwordResetSchema, pickPasswordPolicy } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { getAppSettings } from "@/lib/settings";
import { hashPassword, revokeAllSessions } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/[id]/password — 管理者によるパスワード再発行。
 * 再発行したら対象ユーザーのセッションは全て切る（乗っ取り時の復旧を確実にするため）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = passwordResetSchema(m, pickPasswordPolicy(await getAppSettings())).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { newPassword, mustChangePassword } = parsed.data;

  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: mustChangePassword ?? true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessions(id);

  await writeAudit({
    entity: "users",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { passwordReset: true },
  });
  return Response.json({ ok: true });
}
