import { emptyTableState, parseTableState } from "@chem/shared";
import { prisma } from "@/lib/db";
import { AUDIT_LOG_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

/** 新しいものから。記録を追うときは、まず直近を見る */
const DEFAULT_STATE = emptyTableState([{ column: "at", direction: "desc" }]);

/** 誰がやったかを出すための、最小限の利用者情報 */
export interface AuditActor {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * 監査ログを、表として引く。
 *
 * 「持ち出しの記録」と「ログインの記録」は、見せたい中身は違うが
 * 引きかたは同じ（絞る・並べる・区切る・人の名前を足す）。そこだけをここに置く。
 *
 * 監査ログには利用者への関連を張っていないので、引いたあとにまとめて名前を引く。
 * 記録そのものに名前を写し取らないのは、二重に持つと食い違うため。
 */
export async function listAuditLogs(actions: string[], url: string) {
  const state = parseTableState(
    new URL(url).searchParams,
    AUDIT_LOG_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  /*
    AND で重ねる。素直に広げると、利用者が指定した action の条件が
    こちらの条件を上書きしてしまい、この画面に出るはずのない記録まで出てしまう
    （たとえば持ち出しの記録に、ただの更新履歴が並ぶ）。
  */
  const where = {
    AND: [{ action: { in: actions } }, buildWhere(AUDIT_LOG_COLUMNS, state.filters)],
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: buildOrderBy(AUDIT_LOG_COLUMNS, state.sort, { at: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // 名前はまとめて引く。1件ずつ引くと、50行で50回の問い合わせになる
  const ids = [...new Set(logs.map((l) => l.actorId).filter((v) => v !== null))];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, displayName: true },
  });

  return {
    logs,
    total,
    page: state.page,
    pageSize: state.pageSize,
    userOf: new Map<string, AuditActor>(users.map((u) => [u.id, u])),
  };
}
