"use client";

import {
  emptyTableState,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, ProductListItemDto, SubstanceListItemDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/**
 * 帳票を作る相手を選ぶ表。
 *
 * **ドキュメント生成の画面の中で選ぶ。**以前は製品・物質の一覧へ飛ばしていたが、
 * 帳票を作りに来た人が別の画面へ移されると、どこにいるのか分からなくなる。
 *
 * ここに置くのは**探すための最小限**（コード・名称）。
 * 込み入った絞り込みが要るときは、製品・物質の一覧で探してから、
 * そのコードでここを絞る
 */

const PRODUCT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);
const SUBSTANCE_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

const PRODUCT_KINDS = [
  { key: "code", kind: "text" },
  { key: "nameJa", kind: "text" },
  { key: "nameEn", kind: "text" },
] satisfies { key: string; kind: ColumnKind }[];

const SUBSTANCE_KINDS = [
  { key: "code", kind: "text" },
  { key: "casNumber", kind: "text" },
  { key: "nameJa", kind: "text" },
  { key: "nameEn", kind: "text" },
] satisfies { key: string; kind: ColumnKind }[];

type Row = { id: string; code: string; nameJa: string; nameEn: string | null };

export function DocTargetPicker({
  target,
  single = false,
  onSelectionChange,
}: {
  target: "PRODUCT" | "SUBSTANCE";
  /**
   * 1件しか選べない表にするか。
   * **まとめて作れないテンプレート（Excel・Word）で使う。**
   * 選ばせてから断ると、選び直しをさせることになる
   */
  single?: boolean;
  /**
   * 選ばれている相手。**作るボタンはこの表の中に置かない。**
   * 手順の最後（④ 生成）に置くので、選びぶんだけを外へ渡す
   */
  onSelectionChange: (ids: string[]) => void;
}) {
  const { m } = useI18n();
  const isProduct = target === "PRODUCT";
  const defaultState = isProduct ? PRODUCT_STATE : SUBSTANCE_STATE;

  const { state, setState, reset, ready } = useTableState(
    isProduct ? "chem.table.docPickProduct" : "chem.table.docPickSubstance",
    isProduct ? PRODUCT_KINDS : SUBSTANCE_KINDS,
    defaultState,
  );
  const query = useMemo(
    () => serializeTableState(state, defaultState).toString(),
    [state, defaultState],
  );

  const [data, setData] = useState<ListResponse<Row> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/${isProduct ? "products" : "substances"}?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 25 });
      return;
    }
    const body = (await res.json()) as ListResponse<ProductListItemDto | SubstanceListItemDto>;
    setData(body as ListResponse<Row>);
  }, [isProduct, query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const columns: TableColumn<Row>[] = useMemo(() => {
    // 中身は列ごとに自分で描く（共通テーブルは既定の描きかたを持たない）
    const code: TableColumn<Row> = {
      key: "code",
      header: isProduct ? m.products.code : m.substances.code,
      kind: "text",
      nullable: false,
      width: 180,
      className: "font-mono text-xs",
      render: (r) => r.code,
    };
    const nameJa: TableColumn<Row> = {
      key: "nameJa",
      header: m.products.nameJa,
      kind: "text",
      nullable: false,
      width: 320,
      render: (r) => r.nameJa,
    };
    const nameEn: TableColumn<Row> = {
      key: "nameEn",
      header: m.products.nameEn,
      kind: "text",
      width: 260,
      render: (r) => r.nameEn ?? "",
    };
    if (isProduct) return [code, nameJa, nameEn];
    return [
      code,
      {
        key: "casNumber",
        header: m.substances.casNumber,
        kind: "text",
        width: 140,
        className: "font-mono text-xs",
        render: (r) => (r as SubstanceListItemDto).casNumber ?? "",
      },
      nameJa,
      nameEn,
    ];
  }, [isProduct, m]);

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        storageKey={isProduct ? "chem.table.docPickProduct" : "chem.table.docPickSubstance"}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={defaultState}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={isProduct ? m.products.empty : m.substances.empty}
        /*
          選ぶのは消すためではなく作るため。**編集の権限は要らない。**
          何件でも選べる（まとめて作れるかは様式による）
        */
        selectable
        singleSelect={single}
        onSelectionChange={(rows) => onSelectionChange(rows.map((r) => r.id))}
        pageSizeOptions={[10, 15, 25, 50]}
        hintText={single ? m.documents.pickHintSingle : m.documents.pickHint}
      />
    </div>
  );
}
