import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/auth/passkey/[id] — 自分の端末の登録を外す。
 *
 * **最後の1つは、他に入る手立てが無いと外させない。**
 * 2要素認証を必須にしている場合、パスキーも認証アプリも無くなると、
 * その人は次から入れなくなる。
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 用事そのもの（2要素認証の登録）。登録し直しの途中でも外せるようにする
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const { id } = await ctx.params;
  const m = await getServerMessages();

  const row = await prisma.passkey.findFirst({ where: { id, userId: user.id } });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  const settings = await getAppSettings();
  if (settings.mfaRequired && user.mfaMethod !== "totp") {
    const left = await prisma.passkey.count({ where: { userId: user.id } });
    if (left <= 1) return jsonError(409, "mfa_required", m.passkey.cannotRemoveLast);
  }

  await prisma.passkey.delete({ where: { id } });
  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "passkey_remove",
    actorId: user.id,
    diff: { deviceLabel: row.deviceLabel },
  });
  return Response.json({ ok: true });
}
