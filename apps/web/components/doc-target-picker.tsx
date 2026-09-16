"use client";

import {
  emptyTableState,
  kindLabelOf,
  ORGANISATION_KINDS,
  pickName,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { FilterLayoutRow } from "@/components/data-table/filter-panel";
import type { TableColumn } from "@/components/data-table/types";
import {
  PRODUCT_DEFAULT_STATE,
  useProductListColumns,
  type ProductListOptions,
} from "@/components/product-list-columns";
import {
  SUBSTANCE_DEFAULT_STATE,
  useSubstanceListColumns,
  type SubstanceListOptions,
} from "@/components/substance-list-columns";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import type { DocPickSelection } from "@/lib/doc-batch";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  ListResponse,
  OrganisationDto,
  ProductListItemDto,
  SubstanceListItemDto,
} from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/**
 * 帳票を作る相手を選ぶ表。
 *
 * **製品・物質の一覧と同じ列・同じ絞り込み**（2026-09-16 指示）。
 * 帳票を作る相手を探す条件は一覧と同じでよく、ここだけ簡単にすると
 * 「一覧で探してからコードで絞り直す」という回り道になっていた。
 *
 * **選択はページをまたいで残る。**「絞り込みに当たる全件を選ぶ」を押すと、
 * 表に出ていない行も含めて、いまの絞り込みに当たる全部が相手になる
 * （その場合は ID ではなく絞り込みの条件を渡し、作る側で引き直す）
 */
export function DocTargetPicker({
  target,
  single = false,
  product,
  substance,
  onSelectionChange,
}: {
  /** 対象なし（NONE）は相手を選ばないので、この表は出さない */
  target: "PRODUCT" | "SUBSTANCE" | "ORGANISATION";
  /**
   * 1件しか選べない表にするか。
   * **まとめて作れないテンプレート（Excel・Word）で使う。**
   * 選ばせてから断ると、選び直しをさせることになる
   */
  single?: boolean;
  product: ProductListOptions;
  substance: SubstanceListOptions;
  /**
   * 選ばれている相手。**作るボタンはこの表の中に置かない。**
   * 手順の最後（④ 生成）に置くので、選びぶんだけを外へ渡す。何も選んでいなければ null
   */
  onSelectionChange: (selection: DocPickSelection | null) => void;
}) {
  if (target === "ORGANISATION") {
    return <OrganisationPicker single={single} onSelectionChange={onSelectionChange} />;
  }
  return target === "PRODUCT" ? (
    <ProductPicker single={single} options={product} onSelectionChange={onSelectionChange} />
  ) : (
    <SubstancePicker single={single} options={substance} onSelectionChange={onSelectionChange} />
  );
}

const ORGANISATION_DEFAULT_STATE: TableState = emptyTableState([
  { column: "displayOrder", direction: "asc" },
]);

/** 組織の表。組織の画面と同じ列（項目数・所属人数は選ぶ役に立たないので出さない） */
function OrganisationPicker({
  single,
  onSelectionChange,
}: {
  single: boolean;
  onSelectionChange: (selection: DocPickSelection | null) => void;
}) {
  const { m, locale } = useI18n();
  const kindNames = useMemo(
    () => ({
      COMPANY: m.organisations.kindCompany,
      DEPARTMENT: m.organisations.kindDepartment,
      PARTNER: m.organisations.kindPartner,
      OTHER: m.organisations.kindOther,
    }),
    [m],
  );
  const columns = useMemo<TableColumn<OrganisationDto>[]>(
    () => [
      {
        key: "code",
        header: m.organisations.code,
        kind: "text",
        width: 120,
        className: "font-mono text-xs",
        render: (o) => o.code,
      },
      {
        key: "kind",
        header: m.organisations.kind,
        kind: "enum",
        width: 110,
        options: ORGANISATION_KINDS.map((k) => ({ value: k, label: kindNames[k] })),
        render: (o) => kindLabelOf(o.kind, o.kindLabel, kindNames),
      },
      {
        key: "nameJa",
        header: m.organisations.nameJa,
        kind: "text",
        width: 240,
        render: (o) => pickName(locale, o.nameJa, o.nameEn),
      },
      {
        key: "nameEn",
        header: m.organisations.nameEn,
        kind: "text",
        width: 200,
        render: (o) => o.nameEn ?? "",
      },
      {
        key: "displayOrder",
        header: m.organisations.displayOrder,
        kind: "number",
        width: 88,
        className: "text-right text-xs",
        render: (o) => String(o.displayOrder),
      },
      {
        key: "activeFlag",
        header: m.common.activeHeader,
        kind: "enum",
        filterLabelHidden: true,
        width: 72,
        className: "text-center",
        options: [
          { value: "true", label: m.users.active },
          { value: "false", label: m.users.inactive },
        ],
        render: (o) => (
          <StatusIcon
            active={o.activeFlag}
            activeLabel={m.users.active}
            inactiveLabel={m.users.inactive}
          />
        ),
      },
    ],
    [m, locale, kindNames],
  );
  return (
    <PickerTable
      storageKey="chem.table.docPickOrganisation"
      endpoint="/api/organisations"
      columns={columns}
      filterLayout={[["code", "kind", "nameJa", "nameEn", "activeFlag"]]}
      defaultState={ORGANISATION_DEFAULT_STATE}
      emptyMessage={m.organisations.empty}
      single={single}
      onSelectionChange={onSelectionChange}
    />
  );
}

function ProductPicker({
  single,
  options,
  onSelectionChange,
}: {
  single: boolean;
  options: ProductListOptions;
  onSelectionChange: (selection: DocPickSelection | null) => void;
}) {
  const { m } = useI18n();
  // 公開状態の列も出す（作業中の製品も相手にできる。一覧の下の表と同じ列）
  const { columns, filterLayout } = useProductListColumns({ ...options, scope: "all" });
  return (
    <PickerTable
      storageKey="chem.table.docPickProduct"
      endpoint="/api/products"
      columns={columns}
      filterLayout={filterLayout}
      defaultState={PRODUCT_DEFAULT_STATE}
      emptyMessage={m.products.empty}
      single={single}
      onSelectionChange={onSelectionChange}
    />
  );
}

function SubstancePicker({
  single,
  options,
  onSelectionChange,
}: {
  single: boolean;
  options: SubstanceListOptions;
  onSelectionChange: (selection: DocPickSelection | null) => void;
}) {
  const { m } = useI18n();
  const { columns, filterLayout } = useSubstanceListColumns({ ...options, scope: "all" });
  return (
    <PickerTable
      storageKey="chem.table.docPickSubstance"
      endpoint="/api/substances"
      columns={columns}
      filterLayout={filterLayout}
      defaultState={SUBSTANCE_DEFAULT_STATE}
      emptyMessage={m.substances.empty}
      single={single}
      onSelectionChange={onSelectionChange}
    />
  );
}

/** 製品・物質・組織で共通の、読み込みと選択の持ちかた */
function PickerTable<T extends ProductListItemDto | SubstanceListItemDto | OrganisationDto>({
  storageKey,
  endpoint,
  columns,
  filterLayout,
  defaultState,
  emptyMessage,
  single,
  onSelectionChange,
}: {
  storageKey: string;
  endpoint: string;
  columns: TableColumn<T>[];
  filterLayout: FilterLayoutRow[];
  defaultState: TableState;
  emptyMessage: string;
  single: boolean;
  onSelectionChange: (selection: DocPickSelection | null) => void;
}) {
  const { m } = useI18n();
  const { state, setState, ready } = useTableState(storageKey, columns, defaultState);
  const query = useMemo(
    () => serializeTableState(state, defaultState).toString(),
    [state, defaultState],
  );

  const [data, setData] = useState<ListResponse<T> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`${endpoint}?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 25 });
      return;
    }
    setData((await res.json()) as ListResponse<T>);
  }, [endpoint, query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /*
    選択。ページをまたいで残す（表に持たせると読み直しで消える）。
    `all` のあいだは「絞り込みに当たる全件」で、チェックは全部付いて動かせない
  */
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const total = data?.total ?? 0;

  /*
    外へ知らせる。ID の並びか、絞り込みの条件（全件のとき）。
    全件のときは、絞り込みを変えるたびに条件と件数を送り直す
  */
  const keysText = [...keys].join(",");
  useEffect(() => {
    if (all) onSelectionChange({ mode: "all", filter: query, total });
    else if (keys.size > 0) onSelectionChange({ mode: "ids", ids: [...keys] });
    else onSelectionChange(null);
    // keys は文字列にして比べる（Set は毎回別のものになる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, keysText, query, total]);

  const clear = () => {
    setAll(false);
    setKeys(new Set());
  };

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        storageKey={storageKey}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={total}
        state={state}
        defaultState={defaultState}
        onStateChange={setState}
        emptyMessage={emptyMessage}
        filterLayout={filterLayout}
        /*
          選ぶのは消すためではなく作るため。**編集の権限は要らない。**
          何件でも選べる（まとめて作れるかは様式による）
        */
        selectable
        singleSelect={single}
        selection={{ keys, onChange: setKeys, all }}
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            {all ? (
              <span className="text-primary text-sm font-medium">
                {m.documents.allSelected(total)}
              </span>
            ) : (
              <>
                {keys.size > 0 && (
                  <span className="text-muted-foreground text-sm">
                    {m.documents.pickedCount(keys.size)}
                  </span>
                )}
                {!single && total > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setAll(true)}>
                    {m.documents.selectAllMatching(total)}
                  </Button>
                )}
              </>
            )}
            {(all || keys.size > 0) && (
              <Button size="sm" variant="ghost" onClick={clear}>
                {m.documents.clearSelection}
              </Button>
            )}
          </div>
        }
        pageSizeOptions={[10, 15, 25, 50, 100]}
        hintText={single ? m.documents.pickHintSingle : m.documents.pickHintAll}
      />
    </div>
  );
}
