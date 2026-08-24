"use client";

import {
  DEFAULT_PAGE_SIZE_OPTIONS,
  parseTableState,
  serializeTableState,
  type ColumnFilter,
  type TableState,
} from "@chem/shared";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  CircleCheck,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { FilterPanel, type FilterLayoutRow } from "./filter-panel";
import {
  DRAG_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  SELECT_COLUMN_WIDTH,
  type TableColumn,
} from "./types";
import { useColumnWidths } from "./use-column-widths";

interface Props<T> {
  /** 端末に列幅・パネル開閉を覚えるための識別子（画面ごとに一意） */
  storageKey: string;
  columns: TableColumn<T>[];
  rows: T[] | null;
  rowKey: (row: T) => string;
  total: number;
  state: TableState;
  /** 既定の状態。これと違うときだけ「フィルター中」を出す */
  defaultState: TableState;
  onStateChange: (updater: (prev: TableState) => TableState) => void;
  onReset: () => void;
  emptyMessage: string;
  /** 編集権限があるときだけ true。先頭にチェックボックスの列と削除ボタンを出す */
  selectable?: boolean;
  /**
   * 1行しか選べない表にする。見出しの「すべて選択」を出さず、
   * 別の行にチェックを付けると前の行のチェックが外れる。
   * 操作がいつも1行に対してのものなら、まとめて選ぶ意味が無い
   */
  singleSelect?: boolean;
  /** 選択した行の削除。確認はこの部品が出すので、呼び出し側は消す処理だけ書く */
  onDeleteSelected?: (rows: T[]) => void | Promise<void>;
  /**
   * 選択した行をまとめて次の状態へ送る操作（申請・発行）。
   * 文言と処理はいつも一組なので、まとめて受ける。渡さなければボタンを出さない。
   */
  bulkAction?: {
    label: string;
    confirm: (n: number) => string;
    run: (rows: T[]) => void | Promise<void>;
  };
  /** 行をダブルクリックしたとき（詳細を開く・その場のフォームに読み込む） */
  onRowActivate?: (row: T) => void;
  /** フィルターの並びを指定する場合、1行に置く列キーを行ごとに並べる */
  filterLayout?: FilterLayoutRow[];
  /** 件数が少なく絞り込む意味が無い表では false にしてパネルごと消す（並べ替えは見出しで行う） */
  showFilters?: boolean;
  /**
   * 新規登録。渡すと表の左上に「＋」のアイコンボタンを出す。
   * 別の画面へ移るものは href、その場でフォームを開くものは onClick を渡す。
   */
  create?: {
    onClick?: () => void;
    href?: string;
    /** 吹き出しに出す言葉。省略すると「新規登録」 */
    label?: string;
    disabled?: boolean;
  };
  /** ＋・ごみ箱に続けて置くボタン（新規登録が2種類ある表など） */
  headerActions?: ReactNode;
  /** 「行をダブルクリックすると詳細を開きます」を出すか */
  showOpenHint?: boolean;
  /**
   * ダブルクリックしたあと、次の画面が出るまでカーソルを砂時計にするか。
   * その場で開くだけの一覧（地域・国）では待ち時間が無いので false にする
   */
  busyOnActivate?: boolean;
  /** 「1ページの件数」に出す選択肢。件数の少ない表では小さい値だけにする */
  pageSizeOptions?: readonly number[];
  /**
   * 行ごとに足す class。親子など、行の種類で見た目を変える表で使う。
   * 選択中の行の背景はこれより後に効くので、上書きされない。
   */
  rowClassName?: (row: T) => string | undefined;
  /**
   * 件数・1ページの件数・ページ送りを出すか。
   * 全部が1画面に収まる小さな表では、置いても押すことが無いので false にする。
   */
  showPager?: boolean;
  /**
   * いま選んでいる行（下の表を絞り込むために「1行だけ選ぶ」使い方をする画面で使う）。
   * チェックボックスの選択（まとめて消す用）とは別のもの。
   */
  selectedKey?: string | null;
  onRowSelect?: (row: T) => void;
  /**
   * 行をつかんで並べ替えられるようにする。渡すと先頭に「つかむ場所」の列が増える。
   * 番号を見せずに、並んでいる順そのものを順位にしたい表で使う。
   */
  onReorder?: (fromKey: string, toKey: string) => void | Promise<void>;
}

/** 罫線。セルの右側に薄い線を引く（最後の列は引かない） */
const CELL_BORDER = "border-r last:border-r-0";
/** チェックボックス列。左右の余白を詰めて中央に置く */
const SELECT_CELL = "px-0 text-center";

/**
 * 一覧の共通部品。すべてのテーブルはこれを使う。
 *
 * - フィルターは表の外（上のパネル）。表の中に入れると列幅に引きずられるため
 * - 行ごとの操作ボタンは置かない。**チェックして上の削除ボタン**、**ダブルクリックで詳細**
 */
export function DataTable<T>({
  storageKey,
  columns: allColumns,
  rows,
  rowKey,
  total,
  state,
  defaultState,
  onStateChange,
  onReset,
  emptyMessage,
  selectable = false,
  singleSelect = false,
  onDeleteSelected,
  bulkAction,
  onRowActivate,
  filterLayout,
  showFilters = true,
  create,
  headerActions,
  showOpenHint = true,
  busyOnActivate = true,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showPager = true,
  rowClassName,
  selectedKey = null,
  onRowSelect,
  onReorder,
}: Props<T>) {
  // 表に出す列。フィルター専用の列（組成のCAS番号など）はここから外す
  const columns = allColumns.filter((c) => !c.filterOnly);
  const { m } = useI18n();
  const { widthOf, setWidth, setWidths, resetWidths, hasCustomWidths } = useColumnWidths(
    `${storageKey}.widths`,
  );
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  /** つかんでいる行と、いま重ねている行 */
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  /**
   * データ列の幅の合計。残り幅（チェックボックス列を除いた分）をこの比率で分け合う。
   * 表示領域のほうが広ければ各列は指定より広がり、狭ければ同じ割合で詰まる。
   * チェックボックス列だけは中身が固定サイズなので、伸び縮みさせず px で固定する。
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectWidth = (selectable ? SELECT_COLUMN_WIDTH : 0) + (onReorder ? DRAG_COLUMN_WIDTH : 0);
  const dataSum = columns.reduce((sum, c) => sum + widthOf(c), 0);
  /*
    データ列は合計が 100% になる比率で置く。チェックボックス列は px で固定してあるので、
    合計は表の幅を少しはみ出す形になり、ブラウザが比率を保ったまま詰めてくれる。
    （calc() で残り幅から計算する書き方は col 要素では効かなかった）
  */
  const pct = (px: number) => `${(dataSum === 0 ? 0 : (px / dataSum) * 100).toFixed(4)}%`;
  // 詰めすぎると読めなくなるので、ここまでしか縮めない（これより狭い画面ではスクロールする）
  const minTableWidth = Math.min(
    selectWidth + dataSum,
    selectWidth + MIN_COLUMN_WIDTH * columns.length,
  );
  /**
   * 指定した幅と実際に描かれる幅の比。
   * 幅を変えるドラッグは画面上の px で動くので、覚える値へ戻すときにこれで割る。
   */
  const scale = () => {
    const el = scrollerRef.current;
    if (!el || dataSum === 0) return 1;
    return (Math.max(el.clientWidth, minTableWidth) - selectWidth) / dataSum;
  };

  // 読み直したら選択は解除する（見えていない行を消してしまわないように）
  useEffect(() => setSelected(new Set()), [rows]);

  /**
   * 行をダブルクリックしてから次の画面が出るまで、カーソルを砂時計にする。
   * 何も変わらないと、押せたのか読み込み中なのか分からないため。
   * 次の画面へ移ればこの一覧が消えるので、片付けで外れる。
   * 移らなかったとき（開くのに失敗した等）に固まらないよう、時間でも外す。
   */
  const busyTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (busyTimer.current !== null) window.clearTimeout(busyTimer.current);
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  function activateRow(row: T) {
    if (!onRowActivate) return;
    if (busyOnActivate) {
      document.body.classList.add("cursor-busy");
      if (busyTimer.current !== null) window.clearTimeout(busyTimer.current);
      busyTimer.current = window.setTimeout(
        () => document.body.classList.remove("cursor-busy"),
        10_000,
      );
    }
    onRowActivate(row);
  }

  const visible = rows ?? [];
  const allChecked = visible.length > 0 && visible.every((r) => selected.has(rowKey(r)));
  const someChecked = visible.some((r) => selected.has(rowKey(r)));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(visible.map(rowKey)) : new Set());
  }

  function toggleRow(key: string, checked: boolean) {
    // 1行しか選べない表では、前のチェックを外してから付ける
    if (singleSelect) {
      setSelected(checked ? new Set([key]) : new Set());
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function runBulkAction() {
    const targets = (rows ?? []).filter((r) => selected.has(rowKey(r)));
    if (targets.length === 0 || !bulkAction) return;
    if (!confirm(bulkAction.confirm(targets.length))) return;
    setDeleting(true);
    try {
      await bulkAction.run(targets);
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
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

  const colSpan = columns.length + (selectable ? 1 : 0) + (onReorder ? 1 : 0);

  /**
   * 表の操作。左から「新規登録（＋）→ その表だけのボタン → ごみ箱」の順に並べる。
   * フィルターと同じ1行に置くので、行が2段になって空白の帯ができることがない。
   */
  const actions =
    create || selectable || bulkAction || headerActions ? (
      <div className="flex flex-wrap items-center gap-2">
        {create && (
          <Button
            size="icon"
            className="size-8"
            title={create.label ?? m.table.create}
            aria-label={create.label ?? m.table.create}
            disabled={create.disabled}
            {...(create.href
              ? { nativeButton: false, render: <Link href={create.href} /> }
              : { onClick: create.onClick })}
          >
            <Plus className="size-4" />
          </Button>
        )}
        {headerActions}
        {selectable && (
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
        )}
        {bulkAction && (
          <Button
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || deleting}
            onClick={() => void runBulkAction()}
          >
            <CircleCheck className="mr-1 size-3.5" />
            {bulkAction.label}
          </Button>
        )}
        {selected.size > 0 && (
          <span className="text-muted-foreground text-sm">
            {m.table.selectedCount(selected.size)}
          </span>
        )}
      </div>
    ) : null;

  const hint =
    onRowActivate && showOpenHint ? (
      <span className="text-muted-foreground text-xs">{m.table.openHint}</span>
    ) : null;

  return (
    <div className="space-y-3">
      {showFilters ? (
        <FilterPanel
          columns={allColumns}
          state={state}
          defaultState={defaultState}
          onFilterChange={setFilter}
          onReset={onReset}
          storageKey={`${storageKey}.filterPanel`}
          filterLayout={filterLayout}
          actions={actions}
          trailing={hint}
          currentQuery={serializeTableState(state, defaultState).toString()}
          onLoadQuery={(query) =>
            onStateChange(() =>
              // 読めない条件（列構成が変わった等）は parseTableState が黙って捨てる
              parseTableState(
                new URLSearchParams(query),
                allColumns.map((c) => ({ key: c.key, kind: c.kind })),
                defaultState,
              ),
            )
          }
        />
      ) : (
        // フィルターを出さない表でも、操作の並びと見た目は同じにする
        (actions || hint) && (
          <div className="bg-background flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            {actions}
            {hint && <div className="ml-auto">{hint}</div>}
          </div>
        )
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
            {onReorder && <col style={{ width: DRAG_COLUMN_WIDTH }} />}
            {selectable && <col style={{ width: SELECT_COLUMN_WIDTH }} />}
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
              {/* つかむ場所の列。見出しは要らない */}
              {onReorder && <TableHead className={cn(CELL_BORDER, SELECT_CELL)} />}
              {selectable && (
                <TableHead className={cn(CELL_BORDER, SELECT_CELL)}>
                  {/* 1行しか選べない表では「すべて選択」を出さない */}
                  {!singleSelect && (
                    <input
                      type="checkbox"
                      aria-label={m.table.selectAll}
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = !allChecked && someChecked;
                      }}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="align-middle"
                    />
                  )}
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
                  onClick={onRowSelect ? () => onRowSelect(row) : undefined}
                  onDoubleClick={onRowActivate ? () => activateRow(row) : undefined}
                  // 落とし先になれるよう、重ねているあいだは既定の動きを止める
                  onDragOver={
                    onReorder && dragKey && dragKey !== key
                      ? (e) => {
                          e.preventDefault();
                          setOverKey(key);
                        }
                      : undefined
                  }
                  onDrop={
                    onReorder && dragKey && dragKey !== key
                      ? (e) => {
                          e.preventDefault();
                          const from = dragKey;
                          setDragKey(null);
                          setOverKey(null);
                          void onReorder(from, key);
                        }
                      : undefined
                  }
                  className={cn(
                    (onRowActivate || onRowSelect) && "cursor-pointer",
                    rowClassName?.(row),
                    // いま落とそうとしている行が分かるよう、上端に線を引く
                    overKey === key && dragKey && "border-primary border-t-2",
                    dragKey === key && "opacity-50",
                  )}
                  // 選んでいる行は背景を変える。ユーティリティが効かない環境があるので変数を直に指定
                  style={selectedKey === key ? { backgroundColor: "var(--secondary)" } : undefined}
                  data-state={selected.has(key) ? "selected" : undefined}
                >
                  {onReorder && (
                    <TableCell className={cn(CELL_BORDER, SELECT_CELL)}>
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          // Firefox は中身を入れないと掴めない
                          e.dataTransfer.setData("text/plain", key);
                          setDragKey(key);
                        }}
                        onDragEnd={() => {
                          setDragKey(null);
                          setOverKey(null);
                        }}
                        // つかむだけ。ここのダブルクリックで詳細を開かない
                        onDoubleClick={(e) => e.stopPropagation()}
                        title={m.table.reorder}
                        aria-label={m.table.reorder}
                        className="text-muted-foreground hover:text-foreground flex cursor-grab justify-center active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" />
                      </span>
                    </TableCell>
                  )}
                  {selectable && (
                    <TableCell className={cn(CELL_BORDER, SELECT_CELL)}>
                      <input
                        type="checkbox"
                        aria-label={m.table.selectRow}
                        checked={selected.has(key)}
                        onChange={(e) => toggleRow(key, e.target.checked)}
                        // チェックのつもりでダブルクリックしても詳細が開かないようにする
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="align-middle"
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

      {/* ページ送りを出さない表でも、幅を変えていれば戻す口だけは残す */}
      {(showPager || hasCustomWidths) && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            {showPager && <span>{m.common.totalCount(total)}</span>}
            {showPager && (
              <select
                aria-label={m.table.pageSize}
                value={state.pageSize}
                onChange={(e) =>
                  onStateChange((prev) => ({ ...prev, pageSize: Number(e.target.value), page: 1 }))
                }
                className="border-input bg-background h-8 rounded-none border px-1 text-xs"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {m.table.perPage(n)}
                  </option>
                ))}
              </select>
            )}
            {hasCustomWidths && (
              <Button variant="ghost" size="sm" onClick={resetWidths}>
                {m.table.resetWidths}
              </Button>
            )}
          </div>
          {showPager && (
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
          )}
        </div>
      )}
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
