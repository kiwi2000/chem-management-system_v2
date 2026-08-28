"use client";

import { activeFilterCount, type ColumnFilter, type TableState } from "@chem/shared";
import { ChevronDown, ChevronRight, FilterX, GripVertical } from "lucide-react";
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
  /** 出し入れの欄に並べる列。表と同じ並びで渡す */
  orderedColumns: TableColumn<T>[];
  /** いま隠している列 */
  hiddenColumns: Set<string>;
  onToggleColumn: (key: string) => void;
  /** 掴んだ位置から落とした位置へ。どちらも「出している列」の中での番号 */
  onMoveColumn: (from: number, to: number) => void;
  onResetColumns: () => void;
  /** 出し入れか並びを変えているか（「元に戻す」を押せるか） */
  columnsChanged: boolean;
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
  orderedColumns,
  hiddenColumns,
  onToggleColumn,
  onMoveColumn,
  onResetColumns,
  columnsChanged,
}: Props<T>) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  /** 出す列を選ぶ欄。フィルターとは別に開け閉めする */
  const [columnsOpen, setColumnsOpen] = useState(false);
  /** 引いている列と、落とそうとしている場所（どちらも出している列の中での番号） */
  const [dragAt, setDragAt] = useState<number | null>(null);
  const [overAt, setOverAt] = useState<number | null>(null);

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
    /*
      **枠で囲うのは、開いた条件の欄だけ。**
      追加・削除やページ送りは表の操作であって、条件の一部ではない。
      いっしょに囲うと、開くたびに関係のないものまで枠に入って意味がずれる
    */
    <div className="space-y-1.5">
      {/* 操作ボタンとフィルターを1行にまとめる。行を分けると空白だけの帯ができてしまう */}
      <div className="flex flex-wrap items-center gap-2">
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

        {/* 掛かっている条件は、フィルターのすぐ後ろ。どのボタンの話かが分かる */}
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

        {/* 出す列。フィルターと同じ形にして、押したときの動きも揃える */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setColumnsOpen((v) => !v)}
          aria-expanded={columnsOpen}
        >
          {columnsOpen ? (
            <ChevronDown className="mr-1 size-4" />
          ) : (
            <ChevronRight className="mr-1 size-4" />
          )}
          {m.table.columnPanel}
          {hiddenColumns.size > 0 && (
            <Badge variant="secondary" className="ml-1">
              {m.table.hiddenCount(hiddenColumns.size)}
            </Badge>
          )}
        </Button>

        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>

      {columnsOpen && (
        <div className="bg-background space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <span className="text-sm font-medium">{m.table.columnPanel}</span>
            <Button variant="outline" size="sm" disabled={!columnsChanged} onClick={onResetColumns}>
              {m.table.resetColumns}
            </Button>
            <span className="text-muted-foreground text-xs">{m.table.columnPanelHint}</span>
          </div>
          {/*
            出す列は表と同じ並びで出す。動かした結果がそのまま読める。
            並べ替えは**つまみを引く**。上下のボタンだと、離れた場所へ動かすのに
            何度も押すことになる
          */}
          <ul className="space-y-1">
            {orderedColumns.map((c) => {
              const shown = !hiddenColumns.has(c.key);
              const visible = orderedColumns.filter((x) => !hiddenColumns.has(x.key));
              const at = visible.findIndex((x) => x.key === c.key);
              // 全部隠すと何も読めなくなる。最後の1つは外させない
              const last = shown && visible.length <= 1;
              return (
                <li
                  key={c.key}
                  className={cn(
                    "flex items-center gap-1 rounded-sm text-sm",
                    overAt === at && dragAt !== null && shown && "border-primary border-t-2",
                    dragAt === at && shown && "opacity-50",
                  )}
                  onDragOver={
                    dragAt === null || !shown
                      ? undefined
                      : (e) => {
                          e.preventDefault();
                          setOverAt(at);
                        }
                  }
                  onDrop={
                    dragAt === null || !shown
                      ? undefined
                      : (e) => {
                          e.preventDefault();
                          onMoveColumn(dragAt, at);
                          setDragAt(null);
                          setOverAt(null);
                        }
                  }
                >
                  {/* つまみ。出している列だけ動かせる（隠したものは並びに関係ない） */}
                  <button
                    type="button"
                    draggable={shown}
                    disabled={!shown}
                    aria-label={`${m.table.reorderColumn}: ${String(c.header)}`}
                    title={m.table.reorderColumn}
                    className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                    onDragStart={(e) => {
                      setDragAt(at);
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox は中身が空だと運べない
                      e.dataTransfer.setData("text/plain", c.key);
                    }}
                    onDragEnd={() => {
                      setDragAt(null);
                      setOverAt(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      onMoveColumn(at, at + (e.key === "ArrowUp" ? -1 : 1));
                    }}
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <input
                    type="checkbox"
                    checked={shown}
                    disabled={last}
                    onChange={() => onToggleColumn(c.key)}
                  />
                  <span className={cn("truncate", !shown && "text-muted-foreground")}>
                    {c.header}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {open && (
        <div className="bg-background space-y-2 rounded-md border p-4">
          {/*
            保存と読込は**開いた中に置く。**条件を書き終えてから使うものなので、
            条件そのものと同じ枠に入っているほうが手順どおりになる
          */}
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <SavedFilters tableKey={storageKey} currentQuery={currentQuery} onLoad={onLoadQuery} />
          </div>
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
