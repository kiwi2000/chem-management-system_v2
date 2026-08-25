import { requireAdmin } from "@/lib/authz";
import { countryOf } from "@/lib/ip-country";
import { listAuditLogs } from "@/lib/audit-list";
import type { LoginLogDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 入口の出来事。成功も失敗も、出ていったことも残す */
const LOGIN_ACTIONS = ["login", "login_failed", "logout"];

/**
 * GET /api/admin/login-log — ログインの記録。
 *
 * 失敗のときは、そもそも誰か分からないことがある（存在しないアドレスで試された等）。
 * そのため、記録に残したメールアドレスをそのまま出す。
 * **入力されたパスワードは残していない。**記録そのものが漏れる元になるため。
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const { logs, total, page, pageSize, userOf } = await listAuditLogs(LOGIN_ACTIONS, req.url);

  const items: LoginLogDto[] = logs.map((l) => {
    const u = l.actorId ? userOf.get(l.actorId) : undefined;
    const d = (l.diff ?? {}) as {
      ip?: string | null;
      email?: string | null;
      reason?: string | null;
      userAgent?: string | null;
    };
    return {
      id: l.id,
      at: l.at.toISOString(),
      action: l.action,
      actorId: l.actorId,
      actorName: u?.displayName ?? null,
      email: u?.email ?? d.email ?? null,
      reason: d.reason ?? null,
      ip: d.ip ?? null,
      country: countryOf(d.ip ?? null),
      userAgent: d.userAgent ?? null,
    };
  });

  return Response.json({ items, total, page, pageSize });
}
