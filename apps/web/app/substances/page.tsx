"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { RowActions } from "@/components/data-table/row-actions";
import type { TableColumn } from "@/components/data-table/types";
import { GazetteNumbers } from "@/components/gazette-numbers";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, SubstanceListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

export default function SubstancesPage() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("SUBSTANCE_EDIT");

  const columns = useMemo<TableColumn<SubstanceListItemDto>[]>(
    () => [
      {
        key: "code",
        header: m.substances.code,
        kind: "text",
        // コード20文字・CAS12桁が等幅で収まる最小限の幅にする
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.code,
      },
      {
        key: "casNumber",
        header: m.substances.casNumber,
        kind: "text",
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.casNumber ?? "—",
      },
      {
        key: "nameJa",
        header: m.substances.nameJa,
        kind: "text",
        width: 240,
        render: (r) => (
          <>
            {pickName(locale, r.nameJa, r.nameEn)}
            {r.aliasCount > 0 && (
              <span className="text-muted-foreground ml-2 text-xs">+{r.aliasCount}</span>
            )}
          </>
        ),
      },
      {
        key: "nameEn",
        header: m.substances.nameEn,
        kind: "text",
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      {
        key: "status",
        header: m.substances.status,
        kind: "enum",
        width: 72,
        options: [
          { value: "ACTIVE", label: m.substances.statusActive },
          { value: "DISCONTINUED", label: m.substances.statusDiscontinued },
        ],
        render: (r) =>
          r.status === "DISCONTINUED" ? (
            <Badge variant="outline" className="px-1 text-[10px]">
              {m.substances.statusDiscontinued}
            </Badge>
          ) : null,
      },
      {
        key: "gazetteNumbers",
        header: m.substances.gazette,
        kind: "text",
        width: 150,
        // 区分ごとに1行ずつ出すので、行の高さを伸ばす
        multiline: true,
        sortable: false,
        render: (r) => <GazetteNumbers items={r.gazetteNumbers} />,
      },
      {
        key: "note",
        header: m.substances.note,
        kind: "text",
        width: 200,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        width: 92,
        className: "text-muted-foreground text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.substances",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<SubstanceListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => serializeTableState(state, DEFAULT_STATE).toString(),
    // 文字列にしてから依存させることで、同じ条件での再取得を防ぐ
    [state],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/substances?${query}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    setData((await res.json()) as ListResponse<SubstanceListItemDto>);
    // state.pageSize はエラー時の表示にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function onDelete(s: SubstanceListItemDto) {
    if (!confirm(m.substances.deleteConfirm(`${s.code}: ${pickName(locale, s.nameJa, s.nameEn)}`)))
      return;
    const res = await fetch(`/api/substances/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    void load();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.substances.title}</h1>
        {editable && (
          <Button nativeButton={false} render={<Link href="/substances/new" />}>
            {m.common.create}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.substances"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.substances.empty}
        actionsWidth={editable ? 84 : 48}
        actions={(s) => (
          <RowActions
            detailHref={`/substances/${s.id}`}
            onDelete={editable ? () => void onDelete(s) : undefined}
          />
        )}
      />
    </div>
  );
}
