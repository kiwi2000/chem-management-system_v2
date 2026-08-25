import { emptyTableState, parseTableState } from "@chem/shared";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ACCESS_LOG_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { AccessLogDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 新しいものから。持ち出しを追うときは、まず直近を見る */
const DEFAULT_STATE = emptyTableState([{ column: "at", direction: "desc" }]);

/**
 * データが外へ出る操作。
 * いまは組成を見たこと（view）だけだが、出力・取込みを作ったらここに並ぶ。
 */
const TAKE_OUT_ACTIONS = ["view", "export", "import"];

/**
 * GET /api/admin/access-log — 持ち出しの記録。
 *
 * 監査ログには利用者・製品への関連を張っていないので、
 * 引いたあとに名前をまとめて引いて組み立てる。
 * 記録そのものに名前を写し取らないのは、二重に持つと食い違うため。
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    ACCESS_LOG_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = {
    action: { in: TAKE_OUT_ACTIONS },
    ...buildWhere(ACCESS_LOG_COLUMNS, state.filters),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: buildOrderBy(ACCESS_LOG_COLUMNS, state.sort, { at: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // 名前はまとめて引く。1件ずつ引くと、50行で100回の問い合わせになる
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter((v) => v !== null))];
  const productIds = [...new Set(logs.map((l) => l.entityId).filter((v) => v !== null))];
  const [users, products] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, email: true, displayName: true },
    }),
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, nameJa: true },
    }),
  ]);
  const userOf = new Map(users.map((u) => [u.id, u]));
  const productOf = new Map(products.map((p) => [p.id, p]));

  const items: AccessLogDto[] = logs.map((l) => {
    const u = l.actorId ? userOf.get(l.actorId) : undefined;
    const p = l.entityId ? productOf.get(l.entityId) : undefined;
    const d = (l.diff ?? {}) as {
      lineCount?: number;
      expanded?: boolean;
      ip?: string | null;
    };
    return {
      id: l.id,
      at: l.at.toISOString(),
      action: l.action,
      actorId: l.actorId,
      // 消えた利用者でも記録は残る。分かる範囲を出す
      actorName: u?.displayName ?? u?.email ?? null,
      productId: l.entityId,
      productCode: p?.code ?? null,
      productName: p?.nameJa ?? null,
      lineCount: d.lineCount ?? null,
      expanded: d.expanded ?? null,
      ip: d.ip ?? null,
    };
  });

  return Response.json({ items, total, page: state.page, pageSize: state.pageSize });
}
