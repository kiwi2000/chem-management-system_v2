"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { AccessLogDto, ApiError, ListResponse, UserSummaryDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/** 新しいものから。持ち出しを追うときは、まず直近を見る */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "at", direction: "desc" }]);

/**
 * 持ち出しの記録。
 *
 * 組成は、暗号化では守れない漏れかたがある。見る権利のある人が正規の手順で開き、
 * そのまま持ち出す形である。この画面は、それを**後から追える**ようにするためのもの。
 * そして**残ると分かっていること自体**が抑えになる。だから隠さず、
 * マニュアルにも「記録されます」と書いてある。
 */
export default function AccessLogPage() {
  const { m, locale } = useI18n();

  /** 誰で絞るかの選択肢。人の名前は利用者の表にしかないので、別に引く */
  const [users, setUsers] = useState<UserSummaryDto[]>([]);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/users?size=200");
      if (res.ok) setUsers(((await res.json()) as ListResponse<UserSummaryDto>).items);
    })();
  }, []);

  const columns = useMemo<TableColumn<AccessLogDto>[]>(
    () => [
      {
        key: "at",
        header: m.accessLog.at,
        kind: "date",
        width: 170,
        className: "text-xs tabular-nums",
        render: (r) => new Date(r.at).toLocaleString(locale),
      },
      {
        key: "actorId",
        header: m.accessLog.actor,
        kind: "enum",
        width: 150,
        options: users.map((u) => ({ value: u.id, label: u.displayName ?? u.email })),
        render: (r) => r.actorName ?? m.accessLog.unknownActor,
      },
      {
        key: "action",
        header: m.accessLog.action,
        kind: "enum",
        width: 120,
        options: [
          { value: "view", label: m.accessLog.actionView },
          { value: "export", label: m.accessLog.actionExport },
          { value: "import", label: m.accessLog.actionImport },
        ],
        render: (r) => actionLabel(m, r),
      },
      {
        key: "product",
        header: m.accessLog.product,
        kind: "text",
        // 対象は別の表なので、ここでは絞り込めない
        sortable: false,
        filterable: false,
        width: 280,
        render: (r) =>
          r.productName ? (
            <span>
              <span className="text-muted-foreground mr-2 font-mono text-xs">{r.productCode}</span>
              {r.productName}
            </span>
          ) : (
            // 製品が消されても記録は残る。何を見たかは分からなくなる
            <span className="text-muted-foreground text-xs">{m.accessLog.goneProduct}</span>
          ),
      },
      {
        key: "lineCount",
        header: m.accessLog.lineCount,
        kind: "number",
        sortable: false,
        filterable: false,
        width: 76,
        className: "text-right tabular-nums",
        render: (r) => r.lineCount ?? "",
      },
      {
        key: "ip",
        header: m.accessLog.from,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 150,
        className: "text-muted-foreground font-mono text-xs",
        render: (r) => r.ip ?? "",
      },
    ],
    [m, locale, users],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.accessLog",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<AccessLogDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/access-log?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<AccessLogDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.accessLog.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{m.accessLog.lead}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.accessLog"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.accessLog.empty}
      />
    </div>
  );
}

/** 何をしたか。組成は「見た」だけでも持ち出しなので、展開したかどうかまで出す */
function actionLabel(m: ReturnType<typeof useI18n>["m"], r: AccessLogDto): string {
  if (r.action !== "view") {
    return r.action === "export" ? m.accessLog.actionExport : m.accessLog.actionImport;
  }
  return r.expanded ? m.accessLog.actionViewExpanded : m.accessLog.actionView;
}
