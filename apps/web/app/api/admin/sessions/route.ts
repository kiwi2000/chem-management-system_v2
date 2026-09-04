import { emptyTableState, parseTableState } from "@chem/shared";
import { currentSessionId } from "@/lib/auth";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { sessionColumns } from "@/lib/list-columns";
import { getAppSettings } from "@/lib/settings";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { SessionDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 最後に動いた人から。誰がいま使っているかを見る画面なので */
const DEFAULT_STATE = emptyTableState([{ column: "lastSeenAt", direction: "desc" }]);

/** 切れたセッションを出しておく日数。行の掃除（purgeExpiredSessions）と同じ */
const KEEP_ENDED_DAYS = 7;

/**
 * GET /api/admin/sessions — セッションの一覧。
 *
 * **生きているものと、切れてから7日以内のもの**を出す。
 * 状態（アクティブ／休止中／終了）は時刻から決めて付ける。
 * 休止中は、最終操作から自動ログアウトの時間を過ぎたもの（次の操作で切れる）。
 * 管理者だけ。誰がどの端末から入っているかは、それ自体が守るべき情報
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const now = new Date();
  const settings = await getAppSettings();
  const idleMs = settings.sessionIdleMinutes * 60_000;
  const columns = sessionColumns(now, idleMs);

  const params = new URL(req.url).searchParams;
  const state = parseTableState(
    params,
    columns.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const since = new Date(now.getTime() - KEEP_ENDED_DAYS * 86_400_000);
  const where = {
    AND: [
      {
        OR: [
          { endedAt: null, expiresAt: { gt: now } },
          { endedAt: { gte: since } },
          { endedAt: null, expiresAt: { lte: now, gte: since } },
        ],
      },
      buildWhere(columns, state.filters),
    ],
  };

  const [rows, total, mine] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: buildOrderBy(columns, state.sort, { lastSeenAt: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        endedAt: true,
        endedReason: true,
        ipAddress: true,
        userAgent: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            permissions: { select: { permission: true } },
          },
        },
      },
    }),
    prisma.session.count({ where }),
    currentSessionId(),
  ]);

  const statusOf = (s: { endedAt: Date | null; expiresAt: Date; lastSeenAt: Date }) =>
    s.endedAt !== null || s.expiresAt <= now
      ? ("ended" as const)
      : now.getTime() - s.lastSeenAt.getTime() > idleMs
        ? ("idle" as const)
        : ("active" as const);

  const items: SessionDto[] = rows.map((s) => ({
    id: s.id,
    status: statusOf(s),
    endedAt: s.endedAt?.toISOString() ?? null,
    // 期限切れで終わったものは印が付いていないので、ここで理由を補う
    endedReason: s.endedReason ?? (s.expiresAt <= now ? "expired" : null),
    userId: s.user.id,
    email: s.user.email,
    displayName: s.user.displayName,
    isAdmin: s.user.permissions.some((p) => p.permission === "ADMIN"),
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    // 自分のセッション。切ると自分が追い出されるので、画面で分かるようにする
    isCurrent: s.id === mine,
  }));

  return Response.json({ items, total, page: state.page, pageSize: state.pageSize });
}
