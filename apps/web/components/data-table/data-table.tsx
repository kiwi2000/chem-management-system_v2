"use client";

import { PAGE_SIZE_OPTIONS, type ColumnFilter, type TableState } from "@chem/shared";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useRef } from "react";
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
import { ACTIONS_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type TableColumn } from "./types";
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
  /** 一番右に置く操作列（並べ替え・絞り込みの対象外） */
  actions?: (row: T) => React.ReactNode;
  /** 操作列の幅（既定はアイコン2つ分） */
  actionsWidth?: number;
  emptyMessage: string;
}

/** 罫線。セルの右側に薄い線を引く（最後の列は引かない） */
const CELL_BORDER = "border-r last:border-r-0";

/**
 * 一覧の共通部品。すべてのテーブルはこれを使う。
 * 絞り込み条件は表の外（上のパネル）に置く。表の中に入れると列幅に引きずられて
 * 入力欄の横幅がばらつくため。
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
  actions,
  actionsWidth = ACTIONS_COLUMN_WIDTH,
  emptyMessage,
}: Props<T>) {
  const { m } = useI18n();
  const { widthOf, setWidth, resetWidths, hasCustomWidths } = useColumnWidths(
    `${storageKey}.widths`,
  );
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

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

      <div className="bg-background overflow-x-auto rounded-md border">
        <Table className="table-fixed">
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c) }} />
            ))}
            {actions && <col style={{ width: actionsWidth }} />}
          </colgroup>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const rule = state.sort.find((s) => s.column === c.key);
                const priority = state.sort.findIndex((s) => s.column === c.key) + 1;
                const canSort = c.sortable !== false;
                return (
                  <TableHead key={c.key} className={cn("relative", CELL_BORDER)}>
                    {canSort ? (
                      <button
                        type="button"
                        onClick={(e) => toggleSort(c.key, e.shiftKey)}
                        className="hover:text-foreground flex w-full items-center gap-1 overflow-hidden"
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
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            {priority}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="block truncate">{c.header}</span>
                    )}
                    <ResizeHandle
                      label={`${c.header} ${m.table.resize}`}
                      current={() => widthOf(c)}
                      onResize={(px) => setWidth(c.key, px)}
                    />
                  </TableHead>
                );
              })}
              {actions && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (actions ? 1 : 0)}
                  className="text-muted-foreground text-center"
                >
                  {m.common.loading}
                </TableCell>
              </TableRow>
            )}
            {rows?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (actions ? 1 : 0)}
                  className="text-muted-foreground text-center"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {rows?.map((row) => (
              <TableRow key={rowKey(row)}>
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
                {actions && <TableCell>{actions(row)}</TableCell>}
              </TableRow>
            ))}
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
