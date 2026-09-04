import { emptyTableState, parseTableState } from "@chem/shared";
import { currentSessionId } from "@/lib/auth";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { SESSION_COLUMNS } from "@/lib/list-columns";
import { getAppSettings } from "@/lib/settings";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { SessionDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 最後に動いた人から。誰がいま使っているかを見る画面なので */
const DEFAULT_STATE = emptyTableState([{ column: "lastSeenAt", direction: "desc" }]);

/**
 * GET /api/admin/sessions — いまログインしている利用者（生きているセッション）。
 *
 * 出すのは**終わっておらず、期限も切れていない**もの。
 * 放置で切れる手前のもの（最終操作から自動ログアウトの時間を過ぎたもの）は
 * 次の操作で切れるだけなのでまだ載っている。`idle` の印を付けて見分ける。
 * 管理者だけ。誰がどの端末から入っているかは、それ自体が守るべき情報
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const params = new URL(req.url).searchParams;
  const state = parseTableState(
    params,
    SESSION_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const now = new Date();
  const where = {
    AND: [{ endedAt: null, expiresAt: { gt: now } }, buildWhere(SESSION_COLUMNS, state.filters)],
  };

  const [rows, total, mine, settings] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: buildOrderBy(SESSION_COLUMNS, state.sort, { lastSeenAt: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
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
    getAppSettings(),
  ]);

  const idleMs = settings.sessionIdleMinutes * 60_000;
  const items: SessionDto[] = rows.map((s) => ({
    id: s.id,
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
    // 最終操作から自動ログアウトの時間を過ぎている。次の操作で切れる
    idle: now.getTime() - s.lastSeenAt.getTime() > idleMs,
  }));

  return Response.json({ items, total, page: state.page, pageSize: state.pageSize });
}
