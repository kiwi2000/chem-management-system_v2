"use client";

import { PUBLISH_STATES, emptyTableState, pickName, type TableState } from "@chem/shared";
import Link from "next/link";
import { useMemo } from "react";
import type { FilterLayoutRow } from "@/components/data-table/filter-panel";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { useI18n } from "@/lib/i18n-client";
import type { ProductListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";

/**
 * 製品一覧の列と絞り込み。
 *
 * **製品の一覧と、ドキュメント生成で相手を選ぶ表で同じものを使う**（2026-09-16 指示）。
 * 帳票を作る相手を探す条件は一覧と同じでよく、別に持つと片方だけ増えていく。
 */

export const PRODUCT_DEFAULT_STATE: TableState = emptyTableState([
  { column: "code", direction: "asc" },
]);

/** フィルターの並び（1行に置く列キー）。指定しない列は下に既定の並びで続く */
const FILTER_LAYOUT: string[][] = [
  ["code", "status", "publishState", "usableAsMaterial"],
  ["nameJa"],
  ["nameEn"],
  ["modelValue", "uses"],
  ["updatedAt", "note"],
];

/** 法規制の節に置く列。組成をたどって決まるので、組成の節と分ける */
const REGULATION_KEYS = [
  "judgement",
  "needsReview",
  "judgementCategories",
  "judgementCategoriesNot",
];

export interface ProductListOptions {
  /** 型式で選べる値（システム設定）。並び順がそのまま表示順 */
  modelOptions: string[];
  /** 用途で選べる値（システム設定）。同上 */
  useOptions: string[];
  /** 「該当法規制」「非該当の規制区分」で選べる規制区分。判定を持っているものだけ */
  judgementCategories: { value: string; label: string }[];
}

export function useProductListColumns({
  modelOptions,
  useOptions,
  judgementCategories,
  scope,
}: ProductListOptions & {
  /**
   * published=公開済だけ / working=まだ公開されていないもの / all=両方（公開状態の列を出す）。
   * 公開済だけの表では公開状態の列を出さない（全部同じ値になるため）
   */
  scope: "published" | "working" | "all";
}) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  // 組成をたどる絞り込み（CAS番号・物質名）は、組成を見られる人にだけ出す（サーバー側も同じ）
  const withComposition = can("COMPOSITION_VIEW");

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
        // 右の「別名も含む」にチェックすると、条件は nameJaWithAliases の列で送られる
        filterVariant: { key: "nameJaWithAliases", label: m.table.includeAliases },
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
        filterVariant: { key: "nameEnWithAliases", label: m.table.includeAliases },
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      // 「別名も含む」の受け皿。表にもフィルターの欄にも出さず、状態の読み書きにだけ使う
      {
        key: "nameJaWithAliases",
        header: m.products.nameJa,
        kind: "text",
        nullable: false,
        filterOnly: true,
        filterable: false,
        sortable: false,
      },
      {
        key: "nameEnWithAliases",
        header: m.products.nameEn,
        kind: "text",
        filterOnly: true,
        filterable: false,
        sortable: false,
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
      ...(withComposition
        ? [
            {
              key: "casNumbers",
              header: m.table.casNumbers,
              kind: "list" as const,
              // 表には出さない。組成をたどる条件なので並べ替えもできない
              filterOnly: true,
              sortable: false,
              filterFullWidth: true,
            },
            {
              key: "substanceNames",
              header: m.table.substanceNames,
              kind: "list" as const,
              // 名前を打つ列。数字の区切りで分けると文字が全部消える
              tokens: "text" as const,
              // CAS番号と同じく組成をたどる。こちらは部分一致で、別名も見る
              filterOnly: true,
              sortable: false,
              filterFullWidth: true,
            },
          ]
        : []),
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
        /*
          選んだ区分に**当たっていない**製品（この版で判定済みのものだけ。要確認は見ない）。
          不使用証明書のように「当たらないこと」で相手を選ぶために（2026-09-16 指示）
        */
        key: "judgementCategoriesNot",
        header: m.judgements.notMatchedCategories,
        kind: "list",
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
    // 公開済だけの表では、状態の列は出さない（全部同じ値になるため）
    return scope === "published" ? cols.filter((c) => c.key !== "publishState") : cols;
  }, [m, locale, modelOptions, useOptions, judgementCategories, scope, withComposition]);

  // 組成の節だけは見出しに文言を使うので、ここで組み立てる
  const filterLayout = useMemo<FilterLayoutRow[]>(
    () => [
      // 見出しは1つ目の行にだけ付ける（節の区切りとして使う）
      ...FILTER_LAYOUT.map((keys, i) => (i === 0 ? { title: m.products.basic, keys } : keys)),
      // 組成の節は、組成を見られる人にだけ
      ...(withComposition
        ? [{ title: m.table.compositionSection, keys: ["casNumbers", "substanceNames"] }]
        : []),
      { title: m.judgements.title, keys: REGULATION_KEYS },
    ],
    [m, withComposition],
  );

  return { columns, filterLayout };
}
