import { emptyTableState, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { countryOf } from "@/lib/ip-country";
import { ACCESS_LOG_COLUMNS, SIGNIN_ACTIONS, TAKEOUT_ACTIONS } from "@/lib/access-log-shared";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { AccessLogDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 新しいものから。記録を追うときは、まず直近を見る */
const DEFAULT_STATE = emptyTableState([{ column: "at", direction: "desc" }]);

const ALL_ACTIONS = [...SIGNIN_ACTIONS, ...TAKEOUT_ACTIONS];

/**
 * GET /api/admin/access-log — アクセス記録。
 *
 * 入口の出来事（ログイン）と、データが外へ出る出来事（組成を見た・出力）を
 * **同じ並びで**返す。分けると「見慣れない場所から入って、そのあと組成を
 * 立て続けに開いた」という流れが見えなくなる。
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const params = new URL(req.url).searchParams;
  const state = parseTableState(
    params,
    ACCESS_LOG_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  /*
    AND で重ねる。素直に広げると、利用者が指定した action の条件が
    こちらの条件を上書きしてしまい、この画面に出るはずのない記録まで出てしまう。
  */
  const where = {
    AND: [{ action: { in: ALL_ACTIONS } }, buildWhere(ACCESS_LOG_COLUMNS, state.filters)],
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
  const productIds = [
    ...new Set(
      logs
        .filter((l) => TAKEOUT_ACTIONS.includes(l.action))
        .map((l) => l.entityId)
        .filter((v) => v !== null),
    ),
  ];
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
    const takeOut = TAKEOUT_ACTIONS.includes(l.action);
    const p = takeOut && l.entityId ? productOf.get(l.entityId) : undefined;
    const d = (l.diff ?? {}) as {
      ip?: string | null;
      email?: string | null;
      reason?: string | null;
      userAgent?: string | null;
      lineCount?: number;
      expanded?: boolean;
    };
    return {
      id: l.id,
      at: l.at.toISOString(),
      action: l.action,
      actorId: l.actorId,
      actorName: u?.displayName ?? null,
      // 失敗は利用者が特定できないことがある。試されたアドレスをそのまま出す
      email: u?.email ?? d.email ?? null,
      reason: d.reason ?? null,
      productId: takeOut ? l.entityId : null,
      productCode: p?.code ?? null,
      productName: p?.nameJa ?? null,
      lineCount: d.lineCount ?? null,
      expanded: d.expanded ?? null,
      ip: d.ip ?? null,
      country: countryOf(d.ip ?? null),
      userAgent: d.userAgent ?? null,
    };
  });

  return Response.json({ items, total, page: state.page, pageSize: state.pageSize });
}

/**
 * DELETE /api/admin/access-log — 記録を消す。
 *
 * 記録が際限なく溜まると読めなくなるので、消せるようにする。
 * ただし**消したこと自体を記録に残す。**
 * 都合の悪い記録を消して回れる作りにすると、記録を置く意味が無くなる。
 */
export async function DELETE(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const { ids, before } = (body ?? {}) as { ids?: unknown; before?: unknown };

  let where;
  let what: string;
  if (Array.isArray(ids) && ids.length > 0 && ids.every((v) => typeof v === "string")) {
    where = { id: { in: ids as string[] }, action: { in: ALL_ACTIONS } };
    what = `選んだ ${ids.length} 件`;
  } else if (typeof before === "string" && !Number.isNaN(Date.parse(before))) {
    where = { at: { lt: new Date(before) }, action: { in: ALL_ACTIONS } };
    what = `${before} より前`;
  } else {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const removed = await prisma.auditLog.deleteMany({ where });

  // 消した記録そのものは戻らないので、消した事実だけは必ず残す
  await writeAudit({
    entity: "audit_logs",
    action: "delete",
    actorId: actor.user.id,
    diff: { what, count: removed.count },
  });

  return Response.json({ ok: true, count: removed.count });
}
