"use client";

import { activeFilterCount, type ColumnFilter, type TableState } from "@chem/shared";
import { ChevronDown, ChevronRight, FilterX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { FilterCell } from "./filter-cell";
import { SavedFilters } from "./saved-filters";
import type { TableColumn } from "./types";

interface Props<T> {
  columns: TableColumn<T>[];
  state: TableState;
  /** 既定の状態。並べ替えが既定のままかどうかの判定に使う */
  defaultState: TableState;
  onFilterChange: (key: string, filter: ColumnFilter | undefined) => void;
  onReset: () => void;
  /** 開閉の状態を端末に覚えるためのキー。保存した条件の紐付けにも使う */
  storageKey: string;
  /** いまの状態をクエリ文字列にしたもの（保存する中身） */
  currentQuery: string;
  /** 保存した条件を読み込むとき */
  onLoadQuery: (query: string) => void;
  /**
   * 並びを指定する場合、1行に置く列キーを行ごとに並べる。
   * ここに書かなかった列は、下に既定の並び（3列）で続けて出す。
   */
  filterLayout?: FilterLayoutRow[];
  /** 表の操作ボタン（＋・ごみ箱など）。この行の左端に置いて1行にまとめる */
  actions?: ReactNode;
  /** 行の右端に寄せるもの（ダブルクリックの説明など） */
  trailing?: ReactNode;
}

/** 1行に置く列キー。見出しを付けたいときは title を添える */
export type FilterLayoutRow = string[] | { title: string; keys: string[] };

/**
 * フィルターのパネル。
 * 表の中に入れると列幅に引きずられて入力欄が伸び縮みするので、表の外に出している。
 * ボタンで開閉でき、閉じていても「フィルター中」であることは分かるようにする。
 */
export function FilterPanel<T>({
  columns,
  state,
  defaultState,
  onFilterChange,
  onReset,
  storageKey,
  currentQuery,
  onLoadQuery,
  filterLayout,
  actions,
  trailing,
}: Props<T>) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  function toggle() {
    setOpen((v) => {
      window.localStorage.setItem(storageKey, v ? "0" : "1");
      return !v;
    });
  }

  const filterCount = activeFilterCount(state);
  const asKey = (s: TableState) => s.sort.map((r) => `${r.column}:${r.direction}`).join(",");
  const sorted = asKey(state) !== asKey(defaultState);
  const active = filterCount > 0 || sorted;

  const filterable = columns.filter((c) => c.filterable !== false);
  const byKey = new Map(filterable.map((c) => [c.key, c]));
  // 指定された並び。存在しない列キーは黙って飛ばす（列構成を変えても壊れないように）
  const laidOut = (filterLayout ?? []).map((row) => {
    const keys = Array.isArray(row) ? row : row.keys;
    return {
      title: Array.isArray(row) ? null : row.title,
      cols: keys.flatMap((key) => {
        const col = byKey.get(key);
        return col ? [col] : [];
      }),
    };
  });
  const placed = new Set(laidOut.flatMap((r) => r.cols).map((c) => c.key));
  const rest = filterLayout ? filterable.filter((c) => !placed.has(c.key)) : filterable;

  return (
    <div className="bg-background rounded-md border">
      {/* 操作ボタンとフィルターを1行にまとめる。行を分けると空白だけの帯ができてしまう */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {actions}
        {actions && <span className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden />}

        <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open}>
          {open ? (
            <ChevronDown className="mr-1 size-4" />
          ) : (
            <ChevronRight className="mr-1 size-4" />
          )}
          {m.table.filterPanel}
        </Button>

        <SavedFilters tableKey={storageKey} currentQuery={currentQuery} onLoad={onLoadQuery} />

        {active && (
          <>
            <Badge variant="secondary">{m.table.filtering}</Badge>
            <span className="text-muted-foreground text-sm">
              {filterCount > 0 && m.table.filterCount(filterCount)}
              {filterCount > 0 && sorted && " ・ "}
              {sorted && m.table.sortCount(state.sort.length)}
            </span>
            <Button variant="outline" size="sm" onClick={onReset}>
              <FilterX className="mr-1 size-3.5" />
              {m.table.clear}
            </Button>
          </>
        )}

        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>

      {open && (
        <div className="space-y-2 border-t p-4">
          {laidOut.map((row, i) => (
            <div
              key={i}
              // 先頭の節はパネルの区切り線がすぐ上にあるので、線を重ねない
              className={cn(row.title && "space-y-2", row.title && i > 0 && "border-t pt-4")}
            >
              {row.title && <div className="text-sm font-medium">{row.title}</div>}
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                {row.cols.map((c) => (
                  <div
                    key={c.key}
                    className={cn("flex items-center gap-2", c.filterFullWidth && "flex-1")}
                  >
                    {/* 見出しは入力欄の左。幅を揃えて、どの行も入力欄の左端が並ぶようにする */}
                    {!c.filterLabelHidden && (
                      <div className="text-muted-foreground w-20 shrink-0 text-right text-xs font-medium">
                        {c.header}
                      </div>
                    )}
                    <FilterCell
                      column={c}
                      value={state.filters[c.key]}
                      onChange={(f) => onFilterChange(c.key, f)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {rest.length > 0 && (
            <div className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
              {rest.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  {!c.filterLabelHidden && (
                    <div className="text-muted-foreground w-20 shrink-0 text-right text-xs font-medium">
                      {c.header}
                    </div>
                  )}
                  <FilterCell
                    column={c}
                    value={state.filters[c.key]}
                    onChange={(f) => onFilterChange(c.key, f)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
