"use client";

import { activeFilterCount, type ColumnFilter, type TableState } from "@chem/shared";
import { ChevronDown, ChevronRight, FilterX } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { FilterCell } from "./filter-cell";
import type { TableColumn } from "./types";

interface Props<T> {
  columns: TableColumn<T>[];
  state: TableState;
  /** 既定の状態。並べ替えが既定のままかどうかの判定に使う */
  defaultState: TableState;
  onFilterChange: (key: string, filter: ColumnFilter | undefined) => void;
  onReset: () => void;
  /** 開閉の状態を端末に覚えるためのキー */
  storageKey: string;
}

/**
 * 絞り込み条件のパネル。
 * 表の中に入れると列幅に引きずられて入力欄が伸び縮みするので、表の外に出している。
 * ボタンで開閉でき、閉じていても「絞り込み中」であることは分かるようにする。
 */
export function FilterPanel<T>({
  columns,
  state,
  defaultState,
  onFilterChange,
  onReset,
  storageKey,
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

  return (
    <div className="bg-background rounded-md border">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open}>
          {open ? (
            <ChevronDown className="mr-1 size-4" />
          ) : (
            <ChevronRight className="mr-1 size-4" />
          )}
          {m.table.filterPanel}
        </Button>

        {active && (
          <>
            <Badge variant="secondary">{m.table.filtering}</Badge>
            <span className="text-muted-foreground text-sm">
              {filterCount > 0 && m.table.filterCount(filterCount)}
              {filterCount > 0 && sorted && " ・ "}
              {sorted && m.table.sortCount(state.sort.length)}
            </span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={onReset}>
              <FilterX className="mr-1 size-3.5" />
              {m.table.clear}
            </Button>
          </>
        )}
      </div>

      {open && (
        <div className="grid gap-x-4 gap-y-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
          {filterable.map((c) => (
            <div key={c.key} className="space-y-1">
              <div className="text-muted-foreground text-xs font-medium">{c.header}</div>
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
  );
}
