"use client";

import {
  PUBLISH_STATES,
  emptyTableState,
  pickName,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { FilterLayoutRow } from "@/components/data-table/filter-panel";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, ProductListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

/** フィルターの並び（1行に置く列キー）。指定しない列は下に既定の並びで続く */
const FILTER_LAYOUT: string[][] = [
  ["code", "status", "publishState", "usableAsMaterial"],
  ["nameJa"],
  ["nameEn"],
  ["modelValue", "uses"],
  ["updatedAt", "note"],
];

/** 法規制の節に置く列。組成をたどって決まるので、組成の節と分ける */
const REGULATION_KEYS = ["judgement", "needsReview", "judgementCategories"];

interface Props {
  /** 型式で選べる値（システム設定）。並び順がそのまま表示順 */
  modelOptions: string[];
  /** 用途で選べる値（システム設定）。同上 */
  useOptions: string[];
  /** 公開が承認制か（申請ボタンを出すか、発行ボタンを出すかの判断） */
  approvalRequired: boolean;
  /** 「該当法規制」で選べる規制区分。判定を持っているものだけ */
  judgementCategories: { value: string; label: string }[];
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
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("PRODUCT_EDIT");

  const columns = useMemo<TableColumn<ProductListItemDto>[]>(() => {
    /** はい/いいえの列は共通の形。狭くしたいのでアイコンで出す */
    const boolColumn = (
      key: string,
      header: string,
      get: (r: ProductListItemDto) => boolean,
      /** フィルターの選択肢の文言。省略すると はい/いいえ */
      labels?: { yes: string; no: string },
    ): TableColumn<ProductListItemDto> => ({
      key,
      header,
      kind: "enum",
      width: 72,
      className: "text-center",
      options: [
        { value: "true", label: labels?.yes ?? m.common.yes },
        { value: "false", label: labels?.no ?? m.common.no },
      ],
      render: (r) => (
        <StatusIcon active={get(r)} activeLabel={m.common.yes} inactiveLabel={m.common.no} />
      ),
    });

    const cols: TableColumn<ProductListItemDto>[] = [
      {
        key: "code",
        header: m.products.code,
        kind: "text",
        // 必須の列。「空白」で絞る意味が無い
        nullable: false,
        // コード20文字が等幅で収まる最小限の幅にする
        width: 104,
        className: "font-mono text-xs",
        // 押すと詳細へ移る。物質・インベントリ・法規制のコードと同じ形
        render: (r) => (
          <Link
            href={`/products/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2"
          >
            {r.code}
          </Link>
        ),
      },
      {
        key: "nameJa",
        header: m.products.nameJa,
        kind: "text",
        nullable: false,
        filterFullWidth: true,
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
        filterFullWidth: true,
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      {
        ...boolColumn("usableAsMaterial", m.products.materialShort, (r) => r.usableAsMaterial, {
          yes: m.products.materialShort,
          no: m.products.nonMaterial,
        }),
        // 選択肢の文言だけで何の列か分かるので、フィルターでは列名を出さない
        filterLabelHidden: true,
      },
      {
        key: "status",
        header: m.common.activeHeader,
        kind: "enum",
        filterLabelHidden: true,
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
        key: "publishState",
        header: m.products.publishState,
        kind: "enum",
        // 状態名はどれも3文字以内。切れない最小限まで詰める
        width: 64,
        className: "px-1 text-center text-xs",
        filterLabelHidden: true,
        options: PUBLISH_STATES.map((v) => ({ value: v, label: m.common.publishStates[v] })),
        // 却下は見落とすと放置されるので、赤の太字で目立たせる
        render: (r) =>
          r.publishState === "REJECTED" ? (
            <span className="text-destructive font-bold">
              {m.common.publishStates[r.publishState]}
            </span>
          ) : (
            m.common.publishStates[r.publishState]
          ),
      },
      {
        key: "modelValue",
        header: m.products.modelValue,
        kind: "enum",
        // 表には出さず、条件としてだけ使う。未選択なら全件、選べばそのいずれか
        filterOnly: true,
        options: modelOptions.map((o) => ({ value: o, label: o })),
      },
      {
        key: "uses",
        header: m.products.uses,
        kind: "enum",
        filterOnly: true,
        sortable: false,
        options: useOptions.map((o) => ({ value: o, label: o })),
      },
      {
        key: "casNumbers",
        header: m.table.casNumbers,
        kind: "list",
        // 表には出さない。組成をたどる条件なので並べ替えもできない
        filterOnly: true,
        sortable: false,
        filterFullWidth: true,
      },
      {
        key: "substanceNames",
        header: m.table.substanceNames,
        kind: "list",
        // CAS番号と同じく組成をたどる。こちらは部分一致で、別名も見る
        filterOnly: true,
        sortable: false,
        filterFullWidth: true,
      },
      {
        key: "judgement",
        header: m.judgements.listHeader,
        kind: "enum",
        // 区分の行を数えて決まるので、並べ替えはできない
        sortable: false,
        width: 84,
        className: "text-center text-xs",
        filterLabelHidden: true,
        options: [
          { value: "hit", label: m.judgements.filterHit },
          { value: "none", label: m.judgements.filterNone },
          { value: "unjudged", label: m.judgements.filterUnjudged },
        ],
        /*
          「該当なし」と「まだ判定していない」は意味がまるで違う。
          どちらも空欄にすると、調べた結果あたらなかったのか、
          そもそも調べていないのかが読めなくなる。
        */
        render: (r) =>
          !r.judged ? (
            <span className="text-muted-foreground" title={m.judgements.listUnjudgedHint}>
              {m.judgements.listUnjudged}
            </span>
          ) : r.hitCount === 0 ? (
            <span className="text-muted-foreground">{m.judgements.listNone}</span>
          ) : (
            <span className="font-medium">{m.judgements.listHit(r.hitCount)}</span>
          ),
      },
      {
        key: "needsReview",
        header: m.judgements.listReviewHeader,
        kind: "enum",
        sortable: false,
        width: 72,
        className: "text-center",
        filterLabelHidden: true,
        options: [
          { value: "true", label: m.judgements.filterReviewYes },
          { value: "false", label: m.judgements.filterReviewNo },
        ],
        // 印が付いているものだけ出す。全行にアイコンが並ぶと目印にならない
        render: (r) =>
          r.needsReview ? (
            <StatusIcon
              active
              activeLabel={m.judgements.needsReview}
              inactiveLabel={m.judgements.needsReview}
            />
          ) : (
            ""
          ),
      },
      {
        key: "judgementCategories",
        header: m.judgements.matchedCategories,
        kind: "list",
        // 表には出さず、条件としてだけ使う。当たった区分は「法規制」の列で数が見える
        filterOnly: true,
        sortable: false,
        filterFullWidth: true,
        options: judgementCategories,
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 92,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ];
    // 上の表は公開済しか並ばないので、状態の列は出さない（全部同じ値になるため）
    return scope === "working" ? cols : cols.filter((c) => c.key !== "publishState");
  }, [m, locale, modelOptions, useOptions, judgementCategories, scope]);

  // 組成の節だけは見出しに文言を使うので、ここで組み立てる
  const filterLayout = useMemo<FilterLayoutRow[]>(
    () => [
      // 見出しは1つ目の行にだけ付ける（節の区切りとして使う）
      ...FILTER_LAYOUT.map((keys, i) => (i === 0 ? { title: m.products.basic, keys } : keys)),
      { title: m.table.compositionSection, keys: ["casNumbers", "substanceNames"] },
      { title: m.judgements.title, keys: REGULATION_KEYS },
    ],
    [m],
  );

  // 1画面に表が2つあるので、URLのクエリを節ごとに分ける
  const storageKey = `chem.table.products.${scope}`;
  const { state, setState, reset, ready } = useTableState(
    storageKey,
    columns,
    DEFAULT_STATE,
    scope,
  );

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
        onReset={reset}
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
