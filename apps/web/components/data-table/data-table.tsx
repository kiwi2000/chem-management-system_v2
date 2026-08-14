"use client";

import {
  PAGE_SIZE_OPTIONS,
  activeFilterCount,
  type ColumnFilter,
  type TableState,
} from "@chem/shared";
import { ArrowDown, ArrowUp, ChevronsUpDown, FilterX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { FilterCell } from "./filter-cell";
import type { TableColumn } from "./types";

interface Props<T> {
  columns: TableColumn<T>[];
  rows: T[] | null;
  rowKey: (row: T) => string;
  total: number;
  state: TableState;
  /** 既定の状態。これと違うときだけ「絞り込み中」の帯を出す */
  defaultState: TableState;
  onStateChange: (updater: (prev: TableState) => TableState) => void;
  onReset: () => void;
  /** 一番右に置く操作列（並べ替え・絞り込みの対象外） */
  actions?: (row: T) => React.ReactNode;
  actionsHeaderClassName?: string;
  emptyMessage: string;
}

/**
 * 一覧の共通部品。すべてのテーブルはこれを使う。
 * 列ごとの絞り込み・複数列の並べ替え・ページングを備え、
 * 絞り込み中は帯で明示して、1クリックで全件に戻せるようにしている。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  total,
  state,
  defaultState,
  onStateChange,
  onReset,
  actions,
  actionsHeaderClassName,
  emptyMessage,
}: Props<T>) {
  const { m } = useI18n();
  const filterCount = activeFilterCount(state);
  const asKey = (s: TableState) => s.sort.map((r) => `${r.column}:${r.direction}`).join(",");
  // 既定の並びのままなら「並べ替えている」とは言わない
  const sorted = asKey(state) !== asKey(defaultState);
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

  const filterable = columns.some((c) => c.filterable !== false);

  return (
    <div className="space-y-3">
      {(filterCount > 0 || sorted) && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
          style={{ backgroundColor: "var(--secondary)" }}
        >
          <Badge variant="secondary">{m.table.filtering}</Badge>
          <span className="text-muted-foreground">
            {filterCount > 0 && m.table.filterCount(filterCount)}
            {filterCount > 0 && sorted && " ・ "}
            {sorted && m.table.sortCount(state.sort.length)}
          </span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onReset}>
            <FilterX className="mr-1 size-3.5" />
            {m.table.clear}
          </Button>
        </div>
      )}

      <div className="bg-background overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const rule = state.sort.find((s) => s.column === c.key);
                const priority = state.sort.findIndex((s) => s.column === c.key) + 1;
                const canSort = c.sortable !== false;
                return (
                  <TableHead key={c.key} className={c.headerClassName}>
                    {canSort ? (
                      <button
                        type="button"
                        onClick={(e) => toggleSort(c.key, e.shiftKey)}
                        className="hover:text-foreground flex items-center gap-1"
                        title={m.table.sortHint}
                      >
                        {c.header}
                        {rule ? (
                          rule.direction === "asc" ? (
                            <ArrowUp className="size-3.5" />
                          ) : (
                            <ArrowDown className="size-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-40" />
                        )}
                        {rule && state.sort.length > 1 && (
                          <span className="text-muted-foreground text-[10px]">{priority}</span>
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                );
              })}
              {actions && <TableHead className={actionsHeaderClassName} />}
            </TableRow>
            {filterable && (
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} className="py-1">
                    {c.filterable !== false && (
                      <FilterCell
                        column={c}
                        value={state.filters[c.key]}
                        onChange={(f) => setFilter(c.key, f)}
                      />
                    )}
                  </TableHead>
                ))}
                {actions && <TableHead />}
              </TableRow>
            )}
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
                  <TableCell key={c.key} className={cn(c.className)}>
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
