"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, ProductListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

export default function ProductsPage() {
  const { m, locale } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const editable = can("PRODUCT_EDIT");
  // 非公開の製品は権限が無ければ1件も返らないので、列自体を出さない
  const showPrivate = can("PRODUCT_VIEW_PRIVATE");

  const columns = useMemo<TableColumn<ProductListItemDto>[]>(() => {
    /** はい/いいえの列は共通の形。狭くしたいのでアイコンで出す */
    const boolColumn = (
      key: string,
      header: string,
      get: (r: ProductListItemDto) => boolean,
    ): TableColumn<ProductListItemDto> => ({
      key,
      header,
      kind: "enum",
      width: 72,
      className: "text-center",
      options: [
        { value: "true", label: m.common.yes },
        { value: "false", label: m.common.no },
      ],
      render: (r) => (
        <StatusIcon active={get(r)} activeLabel={m.common.yes} inactiveLabel={m.common.no} />
      ),
    });

    return [
      {
        key: "code",
        header: m.products.code,
        kind: "text",
        // コード20文字が等幅で収まる最小限の幅にする
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.code,
      },
      {
        key: "nameJa",
        header: m.products.nameJa,
        kind: "text",
        width: 260,
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
        header: m.products.nameEn,
        kind: "text",
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      boolColumn("usableAsMaterial", m.products.materialShort, (r) => r.usableAsMaterial),
      ...(showPrivate
        ? [boolColumn("privateFlag", m.products.privateShort, (r) => r.privateFlag)]
        : []),
      boolColumn(
        "compositionPublicFlag",
        m.products.compositionShort,
        (r) => r.compositionPublicFlag,
      ),
      {
        key: "status",
        header: m.common.activeHeader,
        kind: "enum",
        width: 72,
        className: "text-center",
        options: [
          { value: "ACTIVE", label: m.products.statusActive },
          { value: "DISCONTINUED", label: m.products.statusDiscontinued },
        ],
        render: (r) => (
          <StatusIcon
            active={r.status !== "DISCONTINUED"}
            activeLabel={m.products.statusActive}
            inactiveLabel={m.products.statusDiscontinued}
          />
        ),
      },
      {
        key: "note",
        header: m.products.note,
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
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ];
  }, [m, locale, showPrivate]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.products",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<ProductListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => serializeTableState(state, DEFAULT_STATE).toString(),
    // 文字列にしてから依存させることで、同じ条件での再取得を防ぐ
    [state],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/products?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    setData((await res.json()) as ListResponse<ProductListItemDto>);
    // state.pageSize はエラー時の表示にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** 確認は共通テーブル側で出す。ここは消す処理だけ */
  async function onDeleteSelected(targets: ProductListItemDto[]) {
    setError(null);
    for (const p of targets) {
      const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.products.title}</h1>
        {editable && (
          <Button nativeButton={false} render={<Link href="/products/new" />}>
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
        storageKey="chem.table.products"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.products.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        onRowActivate={(p) => router.push(`/products/${p.id}`)}
      />
    </div>
  );
}
