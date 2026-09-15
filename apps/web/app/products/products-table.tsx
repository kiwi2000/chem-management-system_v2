"use client";

import { serializeTableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import {
  PRODUCT_DEFAULT_STATE,
  useProductListColumns,
  type ProductListOptions,
} from "@/components/product-list-columns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, ProductListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE = PRODUCT_DEFAULT_STATE;

interface Props extends ProductListOptions {
  /** 公開が承認制か（申請ボタンを出すか、発行ボタンを出すかの判断） */
  approvalRequired: boolean;
  /** published=公開済だけ / working=まだ公開されていないもの */
  scope: "published" | "working";
  /** 節の見出し。1つしか出ないときは省く */
  title?: string;
  /** 相手側の表を読み直させるための合図 */
  reloadToken: number;
  onChanged: () => void;
}

export function ProductsTable({
  modelOptions,
  useOptions,
  approvalRequired,
  judgementCategories,
  scope,
  title,
  reloadToken,
  onChanged,
}: Props) {
  const { m } = useI18n();
  const { can } = useMe();
  const editable = can("PRODUCT_EDIT");

  // 列と絞り込みは、ドキュメント生成の相手選びと共通（product-list-columns.tsx）
  const { columns, filterLayout } = useProductListColumns({
    modelOptions,
    useOptions,
    judgementCategories,
    scope,
  });

  // 1画面に表が2つあるので、URLのクエリを節ごとに分ける
  const storageKey = `chem.table.products.${scope}`;
  const { state, setState, ready } = useTableState(storageKey, columns, DEFAULT_STATE, scope);

  const [data, setData] = useState<ListResponse<ProductListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = serializeTableState(state, DEFAULT_STATE);
    // 節で決まる条件は利用者が変えられないので、画面の状態とは別にここで足す
    params.set(
      "f.publishState",
      scope === "published" ? "in:PUBLISHED" : "in:DRAFT|PENDING|REJECTED",
    );
    return params.toString();
    // 文字列にしてから依存させることで、同じ条件での再取得を防ぐ
  }, [state, scope]);

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
  }, [ready, load, reloadToken]);

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

  /** 選択した行をまとめて次の状態へ。権限が無いものはサーバー側で飛ばされる */
  async function runBulk(action: "submit" | "publish" | "approve", targets: ProductListItemDto[]) {
    setError(null);
    const res = await fetch("/api/products/publish-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets.map((t) => t.id), action }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    const body = (await res.json()) as { updated: number; requested: number };
    if (body.updated < body.requested) {
      setError(m.common.actionDone(body.updated, body.requested));
    }
    onChanged();
  }

  return (
    // 外側（一覧の画面）が余白を持っているので、ここでは付けない（物質の一覧と同じ）
    <div className="w-full space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey={storageKey}
        title={title ?? m.products.title}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.products.empty}
        create={editable && scope === "published" ? { href: "/products/new" } : undefined}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        bulkAction={
          scope === "working"
            ? {
                label: approvalRequired ? m.common.submitSelected : m.common.publishSelected,
                confirm: approvalRequired ? m.common.submitConfirm : m.common.publishConfirm,
                run: (rows) => void runBulk(approvalRequired ? "submit" : "publish", rows),
              }
            : undefined
        }
        filterLayout={filterLayout}
        // 詳細へはコードのリンクから移る。編集はその画面の「編集」から行う
      />
    </div>
  );
}
