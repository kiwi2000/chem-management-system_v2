"use client";

import { PUBLISH_STATES, emptyTableState, pickName, type TableState } from "@chem/shared";
import Link from "next/link";
import { useMemo } from "react";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { useI18n } from "@/lib/i18n-client";
import type { SubstanceListItemDto } from "@/lib/types";

/**
 * 物質一覧の列と絞り込み。
 *
 * **物質の一覧と、ドキュメント生成で相手を選ぶ表で同じものを使う**（2026-09-16 指示）。
 */

export const SUBSTANCE_DEFAULT_STATE: TableState = emptyTableState([
  { column: "code", direction: "asc" },
]);

/** フィルターの並び。ここに無い列は、この後ろに2列で並ぶ */
export const SUBSTANCE_FILTER_LAYOUT: string[][] = [
  ["code", "casRepresentative", "status"],
  ["casNumber"],
  ["nameJa"],
  ["nameEn"],
  // スコア・ランク・備考・更新日は横1行（2026-09-11 指示）
  ["score", "scoreRank", "note", "updatedAt"],
];

export interface SubstanceListOptions {
  /** ランクの絞り込みで選べる段の名前（設定の順） */
  rankOptions: string[];
}

export function useSubstanceListColumns({
  rankOptions,
  scope,
}: SubstanceListOptions & {
  /** published=公開済だけ / working=まだ公開されていないもの / all=両方（公開状態の列を出す） */
  scope: "published" | "working" | "all";
}) {
  const { m, locale } = useI18n();

  const columns = useMemo<TableColumn<SubstanceListItemDto>[]>(() => {
    const cols: TableColumn<SubstanceListItemDto>[] = [
      {
        key: "code",
        header: m.substances.code,
        kind: "text",
        // 必須の列。「空白」で絞る意味が無い
        nullable: false,
        // コード20文字・CAS12桁が等幅で収まる最小限の幅にする
        width: 104,
        className: "font-mono text-xs",
        // 押すと詳細へ移る。インベントリ・法規制のコードと同じ形
        render: (r) => (
          <Link
            href={`/substances/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2"
          >
            {r.code}
          </Link>
        ),
      },
      {
        key: "casNumber",
        header: m.substances.casNumber,
        // 絞り込みは複数まとめて打てる（製品の組成のCAS番号と同じ欄）。列としてはこれまでどおり
        kind: "list",
        filterFullWidth: true,
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.casNumber ?? "—",
      },
      {
        // 同じCASの物質が複数あるとき、合算した行の名前をどれから取るか（代表）。星で示す
        key: "casRepresentative",
        header: m.substances.casRepresentativeShort,
        kind: "enum",
        width: 64,
        className: "text-center",
        options: [
          { value: "true", label: m.substances.casRepresentativeYes },
          { value: "false", label: m.substances.casRepresentativeNo },
        ],
        render: (r) =>
          r.casRepresentative ? (
            // 代表の印は ✅（2026-09-11 指示。星から変えた）
            <span
              className="block text-center"
              role="img"
              aria-label={m.substances.casRepresentativeYes}
            >
              ✅
            </span>
          ) : null,
      },
      {
        key: "nameJa",
        header: m.substances.nameJa,
        kind: "text",
        nullable: false,
        filterFullWidth: true,
        // 右の「別名も含む」にチェックすると、条件は nameJaWithAliases の列で送られる（製品と同じ）
        filterVariant: { key: "nameJaWithAliases", label: m.table.includeAliases },
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
        filterFullWidth: true,
        filterVariant: { key: "nameEnWithAliases", label: m.table.includeAliases },
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      // 「別名も含む」の受け皿。表にもフィルターの欄にも出さず、状態の読み書きにだけ使う
      {
        key: "nameJaWithAliases",
        header: m.substances.nameJa,
        kind: "text",
        nullable: false,
        filterOnly: true,
        filterable: false,
        sortable: false,
      },
      {
        key: "nameEnWithAliases",
        header: m.substances.nameEn,
        kind: "text",
        filterOnly: true,
        filterable: false,
        sortable: false,
      },
      {
        key: "status",
        header: m.common.activeHeader,
        kind: "enum",
        // 選択肢の文言（有効/無効）だけで分かるので、フィルターでは列名を出さない
        filterLabelHidden: true,
        width: 72,
        className: "text-center",
        options: [
          { value: "ACTIVE", label: m.substances.statusActive },
          { value: "DISCONTINUED", label: m.substances.statusDiscontinued },
        ],
        render: (r) => (
          <StatusIcon
            active={r.status !== "DISCONTINUED"}
            activeLabel={m.substances.statusActive}
            inactiveLabel={m.substances.statusDiscontinued}
          />
        ),
      },
      {
        key: "publishState",
        header: m.substances.publishState,
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
        key: "numbers",
        header: m.substances.numbers,
        kind: "text",
        width: 150,
        sortable: false,
        filterable: false,
        className: "text-xs",
        // インベントリから引いた番号。呼び名を添えて1セルに複数行で出す
        render: (r) => (
          <div className="space-y-0.5">
            {r.numbers.map((n, k) => (
              <div key={k} className="truncate">
                <span className="text-muted-foreground">{n.label}</span>{" "}
                <span className="font-mono">{n.number}</span>
              </div>
            ))}
          </div>
        ),
      },
      /*
        スコアとランク。**計算して書いてある値なので、ここでは出すだけ。**
        当たっている規制区分の点数の合計で、製品とは関係しない。
        列に出すのはランクだけ。スコアの数字はランクにマウスを置くと浮く（合算表と同じ）。
        スコアで絞る道は残す（絞り込みの欄にだけ出る）
      */
      {
        key: "score",
        header: m.score.substanceScore,
        kind: "number",
        // 必ず数字が入る（既定 0）。「空白」「空白でない」は出さない（2026-09-11 指示）
        nullable: false,
        width: 90,
        filterOnly: true,
        className: "text-right font-mono tabular-nums",
        render: (r) => r.score,
      },
      {
        key: "scoreRank",
        header: m.score.substanceRank,
        // 設定で決めた段から選ぶ（2026-09-11 指示）
        kind: "enum",
        options: rankOptions.map((label) => ({ value: label, label })),
        width: 80,
        render: (r) => (
          <span title={m.score.scoreOf(r.score)}>{r.scoreRank ?? m.score.noRank}</span>
        ),
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
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 92,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ];
    // 公開済だけの表では、状態の列は出さない（全部同じ値になるため）
    return scope === "published" ? cols.filter((c) => c.key !== "publishState") : cols;
  }, [m, locale, scope, rankOptions]);

  return { columns, filterLayout: SUBSTANCE_FILTER_LAYOUT };
}
