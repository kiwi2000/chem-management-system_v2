"use client";

import { PAGE_SIZE_OPTIONS, type ColumnFilter, type TableState } from "@chem/shared";
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { FilterPanel } from "./filter-panel";
import { MIN_COLUMN_WIDTH, SELECT_COLUMN_WIDTH, type TableColumn } from "./types";
import { useColumnWidths } from "./use-column-widths";

interface Props<T> {
  /** 端末に列幅・パネル開閉を覚えるための識別子（画面ごとに一意） */
  storageKey: string;
  columns: TableColumn<T>[];
  rows: T[] | null;
  rowKey: (row: T) => string;
  total: number;
  state: TableState;
  /** 既定の状態。これと違うときだけ「絞り込み中」を出す */
  defaultState: TableState;
  onStateChange: (updater: (prev: TableState) => TableState) => void;
  onReset: () => void;
  emptyMessage: string;
  /** 編集権限があるときだけ true。先頭にチェックボックスの列と削除ボタンを出す */
  selectable?: boolean;
  /** 選択した行の削除。確認はこの部品が出すので、呼び出し側は消す処理だけ書く */
  onDeleteSelected?: (rows: T[]) => void | Promise<void>;
  /** 行をダブルクリックしたとき（詳細を開く・その場のフォームに読み込む） */
  onRowActivate?: (row: T) => void;
}

/** 罫線。セルの右側に薄い線を引く（最後の列は引かない） */
const CELL_BORDER = "border-r last:border-r-0";

/**
 * 一覧の共通部品。すべてのテーブルはこれを使う。
 *
 * - 絞り込み条件は表の外（上のパネル）。表の中に入れると列幅に引きずられるため
 * - 行ごとの操作ボタンは置かない。**チェックして上の削除ボタン**、**ダブルクリックで詳細**
 */
export function DataTable<T>({
  storageKey,
  columns,
  rows,
  rowKey,
  total,
  state,
  defaultState,
  onStateChange,
  onReset,
  emptyMessage,
  selectable = false,
  onDeleteSelected,
  onRowActivate,
}: Props<T>) {
  const { m } = useI18n();
  const { widthOf, setWidth, setWidths, resetWidths, hasCustomWidths } = useColumnWidths(
    `${storageKey}.widths`,
  );
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  /**
   * 列幅の合計。これを 100% とみなして各列を比率で置く。
   * 表示領域のほうが広ければ各列は指定より広がり、狭ければ同じ割合で詰まる。
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const widthSum =
    (selectable ? SELECT_COLUMN_WIDTH : 0) + columns.reduce((sum, c) => sum + widthOf(c), 0);
  const pct = (px: number) => `${((px / widthSum) * 100).toFixed(4)}%`;
  // 詰めすぎると読めなくなるので、ここまでしか縮めない（これより狭い画面ではスクロールする）
  const minTableWidth = Math.min(widthSum, MIN_COLUMN_WIDTH * (columns.length + 1));
  /**
   * 指定した幅と実際に描かれる幅の比。
   * 幅を変えるドラッグは画面上の px で動くので、覚える値へ戻すときにこれで割る。
   */
  const scale = () => {
    const el = scrollerRef.current;
    if (!el || widthSum === 0) return 1;
    return Math.max(el.clientWidth, minTableWidth) / widthSum;
  };

  // 読み直したら選択は解除する（見えていない行を消してしまわないように）
  useEffect(() => setSelected(new Set()), [rows]);

  const visible = rows ?? [];
  const allChecked = visible.length > 0 && visible.every((r) => selected.has(rowKey(r)));
  const someChecked = visible.some((r) => selected.has(rowKey(r)));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(visible.map(rowKey)) : new Set());
  }

  function toggleRow(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function deleteSelected() {
    const targets = visible.filter((r) => selected.has(rowKey(r)));
    if (targets.length === 0 || !onDeleteSelected) return;
    if (!confirm(m.table.deleteSelectedConfirm(targets.length))) return;
    setDeleting(true);
    try {
      await onDeleteSelected(targets);
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  }

  /** 見出しクリックで 昇順 → 降順 → 解除。Shift+クリックで並べ替えのキーを足す */
  function toggleSort(key: string, additive: boolean) {
    onStateChange((prev) => {
      const current = prev.sort.find((s) => s.column === key);
      const others = additive ? prev.sort.filter((s) => s.column !== key) : [];
      let next = others;
      if (!current) next = [...others, { column: key, direction: "asc" as const }];
      else if (current.direction === "asc")
        next = [...others, { column: key, direction: "desc" as const }];
      return { ...prev, sort: next, page: 1 };
    });
  }

  function setFilter(key: string, filter: ColumnFilter | undefined) {
    onStateChange((prev) => {
      const filters = { ...prev.filters };
      if (filter) filters[key] = filter;
      else delete filters[key];
      return { ...prev, filters, page: 1 };
    });
  }

  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className="space-y-3">
      <FilterPanel
        columns={columns}
        state={state}
        defaultState={defaultState}
        onFilterChange={setFilter}
        onReset={onReset}
        storageKey={`${storageKey}.filterPanel`}
      />

      {selectable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            title={m.table.deleteSelected}
            aria-label={m.table.deleteSelected}
            disabled={selected.size === 0 || deleting}
            onClick={() => void deleteSelected()}
          >
            <Trash2 className="size-4" />
          </Button>
          {selected.size > 0 && (
            <span className="text-muted-foreground text-sm">
              {m.table.selectedCount(selected.size)}
            </span>
          )}
          {onRowActivate && (
            <span className="text-muted-foreground ml-auto text-xs">{m.table.openHint}</span>
          )}
        </div>
      )}

      <div ref={scrollerRef} className="bg-background overflow-x-auto rounded-md border">
        {/*
          列幅は比率で指定する。
          合計が表示領域より広いときは全体を同じ割合で詰めるので、
          余白があるのに横スクロールバーが出る、という状態にならない。
          ただし詰めすぎると読めないので、min-width より狭くはしない（そのときだけスクロールする）。
        */}
        <Table className="table-fixed" style={{ minWidth: minTableWidth }}>
          <colgroup>
            {selectable && <col style={{ width: pct(SELECT_COLUMN_WIDTH) }} />}
            {columns.map((c) => (
              <col key={c.key} style={{ width: pct(widthOf(c)) }} />
            ))}
          </colgroup>
          {/*
            テーマによっては濃い色が敷かれる。中の文字色は table-head-foreground に従わせる。
            th は既定で text-foreground を持つので、打ち消して継承させる。
          */}
          <TableHeader className="bg-table-head text-table-head-foreground [&_th]:text-inherit">
            <TableRow>
              {selectable && (
                <TableHead className={CELL_BORDER}>
                  <input
                    type="checkbox"
                    aria-label={m.table.selectAll}
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !allChecked && someChecked;
                    }}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </TableHead>
              )}
              {columns.map((c, i) => {
                const rule = state.sort.find((s) => s.column === c.key);
                const priority = state.sort.findIndex((s) => s.column === c.key) + 1;
                const canSort = c.sortable !== false;
                const neighbor = columns[i + 1];
                return (
                  <TableHead key={c.key} className={cn("relative", CELL_BORDER)}>
                    {canSort ? (
                      <button
                        type="button"
                        onClick={(e) => toggleSort(c.key, e.shiftKey)}
                        // 濃いヘッダーでも成り立つよう、色を変えず濃さで反応させる
                        className="flex w-full items-center justify-center gap-1 overflow-hidden hover:opacity-75"
                        title={`${c.header} — ${m.table.sortHint}`}
                      >
                        <span className="truncate">{c.header}</span>
                        {rule ? (
                          rule.direction === "asc" ? (
                            <ArrowUp className="size-3.5 shrink-0" />
                          ) : (
                            <ArrowDown className="size-3.5 shrink-0" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" />
                        )}
                        {rule && state.sort.length > 1 && (
                          <span className="shrink-0 text-[10px] opacity-70">{priority}</span>
                        )}
                      </button>
                    ) : (
                      <span className="block truncate text-center">{c.header}</span>
                    )}
                    <ResizeHandle
                      label={`${c.header} ${m.table.resize}`}
                      current={() => widthOf(c) * scale()}
                      onResize={(px) => {
                        const want = px / scale();
                        // 隣から同じだけもらう（合計が変わらないので掴んだ位置がずれない）
                        if (!neighbor) return setWidth(c.key, want);
                        const delta = want - widthOf(c);
                        const room = widthOf(neighbor) - MIN_COLUMN_WIDTH;
                        const move = Math.min(delta, room);
                        setWidths({
                          [c.key]: widthOf(c) + move,
                          [neighbor.key]: widthOf(neighbor) - move,
                        });
                      }}
                    />
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null && (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-muted-foreground text-center">
                  {m.common.loading}
                </TableCell>
              </TableRow>
            )}
            {rows?.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-muted-foreground text-center">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {rows?.map((row) => {
              const key = rowKey(row);
              return (
                <TableRow
                  key={key}
                  onDoubleClick={onRowActivate ? () => onRowActivate(row) : undefined}
                  className={cn(onRowActivate && "cursor-pointer")}
                  data-state={selected.has(key) ? "selected" : undefined}
                >
                  {selectable && (
                    <TableCell className={CELL_BORDER}>
                      <input
                        type="checkbox"
                        aria-label={m.table.selectRow}
                        checked={selected.has(key)}
                        onChange={(e) => toggleRow(key, e.target.checked)}
                        // チェックのつもりでダブルクリックしても詳細が開かないようにする
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        c.multiline ? "align-top break-words whitespace-normal" : "truncate",
                        CELL_BORDER,
                        c.className,
                      )}
                    >
                      {c.render?.(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span>{m.common.totalCount(total)}</span>
          <select
            aria-label={m.table.pageSize}
            value={state.pageSize}
            onChange={(e) =>
              onStateChange((prev) => ({ ...prev, pageSize: Number(e.target.value), page: 1 }))
            }
            className="border-input bg-background h-8 rounded-md border px-1 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {m.table.perPage(n)}
              </option>
            ))}
          </select>
          {hasCustomWidths && (
            <Button variant="ghost" size="sm" onClick={resetWidths}>
              {m.table.resetWidths}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={state.page <= 1}
            onClick={() => onStateChange((prev) => ({ ...prev, page: prev.page - 1 }))}
          >
            {m.common.prev}
          </Button>
          <span>{m.common.pageOf(state.page, totalPages)}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={state.page >= totalPages}
            onClick={() => onStateChange((prev) => ({ ...prev, page: prev.page + 1 }))}
          >
            {m.common.next}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 列幅を変えるつまみ。見出しの右端をドラッグする。
 * キーボードでも矢印キーで変えられるようにしている。
 */
function ResizeHandle({
  label,
  current,
  onResize,
}: {
  label: string;
  current: () => number;
  onResize: (px: number) => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className="hover:bg-primary/40 focus-visible:bg-primary/40 absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: current() };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onResize(
          Math.max(MIN_COLUMN_WIDTH, drag.current.startWidth + (e.clientX - drag.current.startX)),
        );
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onResize(current() - step);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onResize(current() + step);
        }
      }}
    />
  );
}
