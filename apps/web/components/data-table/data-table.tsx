"use client";

import {
  parseTableState,
  serializeTableState,
  type ColumnFilter,
  type TableState,
} from "@chem/shared";
import {
  ArrowDown,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircleCheck,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";
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
import { usePageSizePrefs } from "@/lib/page-size-prefs";
import { useTablePeek } from "@/components/data-table/cell-peek";
import { cn } from "@/lib/utils";
import { FilterPanel, type FilterLayoutRow } from "./filter-panel";
import {
  ACTION_COLUMN_WIDTH,
  DRAG_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  SELECT_COLUMN_WIDTH,
  type TableColumn,
} from "./types";
import { measuredRowHeight, ResizeHandle, RowResizeHandle } from "./resizable-columns";
import { applyColumnOrder, useColumnVisibility } from "@/lib/use-column-visibility";
import { useColumnWidths } from "./use-column-widths";
import { rowHeightOf, rowLinesOf, useRowLines } from "./use-row-lines";

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
   * 選ばれている行が変わったときに知らせる。
   * **表の外にボタンを置く画面で使う**（ドキュメント生成の「生成」など、
   * 手順の最後に置きたい操作は、表の道具立ての中では見つけられない）
   */
  onSelectionChange?: (rows: T[]) => void;
  /**
   * 選択した行をまとめて次の状態へ送る操作（申請・発行）。
   * 文言と処理はいつも一組なので、まとめて受ける。渡さなければボタンを出さない。
   */
  bulkAction?: {
    label: string;
    /**
     * 念押しの文。**省略すると、押してすぐ動く。**
     * 取り返しの付かないもの（公開・申請）にだけ付ける
     */
    confirm?: (n: number) => string;
    /**
     * その画面の**主役の操作**か。
     * 塗りつぶしたボタンで出す（ドキュメント生成の「生成」など、
     * それを押しに来た人がいる操作は、控えめに置くと見つからない）
     */
    primary?: boolean;
    run: (rows: T[]) => void | Promise<void>;
  };
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
  /**
   * 行の右端に置く操作。いまは編集にだけ使っている。
   *
   * 編集をダブルクリックに割り当てると、シングルクリックに別の意味がある表では
   * 掘る動作まで一緒に起きてしまう（ブラウザは click を2回出してから dblclick を出す）。
   * 見える場所を1つ作って、そこを押したときだけ編集に入る形にする。
   */
  rowAction?: {
    onClick: (row: T) => void;
    /** 押す場所の絵。省略すると鉛筆（編集） */
    icon?: LucideIcon;
    /** 吹き出しに出す言葉。省略すると「編集」 */
    label?: string;
    /** 行によって押せなくする（すでに編集中の行など） */
    disabled?: (row: T) => boolean;
    /**
     * 押してから次の画面が出るまで、カーソルを砂時計にするか。
     * 別の画面へ移るものだけ true にする。その場で開くものは待ち時間が無い
     */
    busy?: boolean;
  };
  /** 行を押すと何が起きるかを、操作の並びの右端に一言で出す */
  hintText?: string;
  /** 「1ページの件数」に出す選択肢。件数の少ない表では小さい値だけにする */
  /**
   * 画面（または節）の名前。**操作の行の左端に置く。**
   * 見出しだけで1行使うと、そのぶん表が下へ押されて読める行が減る
   */
  title?: ReactNode;
  /** 指定しなければ、その人の設定（`個人設定 → 1ページの件数`）に従う */
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

/** 表の名前。**どの画面でも同じ大きさ**にする（画面ごとに違うと落ち着かない） */
export const TABLE_TITLE = "mr-1 text-xl font-semibold";
/** チェックボックス列。左右の余白を詰めて中央に置く */
const SELECT_CELL = "px-0 text-center";

/**
 * 一覧の共通部品。すべてのテーブルはこれを使う。
 *
 * - フィルターは表の外（上のパネル）。表の中に入れると列幅に引きずられるため
 * - 削除は**チェックして上の削除ボタン**。詳細へは**先頭列のコードのリンク**、
 *   行内で直すマスタは**行末の鉛筆**（rowAction）。行のダブルクリックには意味を持たせない
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
  onSelectionChange,
  bulkAction,
  filterLayout,
  showFilters = true,
  create,
  headerActions,
  rowAction,
  hintText,
  title,
  pageSizeOptions,
  showPager = true,
  rowClassName,
  selectedKey = null,
  onRowSelect,
  onReorder,
}: Props<T>) {
  // 表に出す列。フィルター専用の列（組成のCAS番号など）はここから外す
  const {
    hidden: hiddenColumns,
    order: columnOrder,
    toggle: toggleColumn,
    moveTo: moveColumn,
    reset: resetColumns,
    changed: columnsChanged,
  } = useColumnVisibility(`${storageKey}.columns`);

  /*
    表に出す列。**絞り込みにしか使わない列**（`filterOnly`）と、
    **本人が隠した列**を外す。隠したぶんは端末に覚える
  */
  const columns = applyColumnOrder(
    allColumns.filter((c) => !c.filterOnly && !hiddenColumns.has(c.key)),
    columnOrder,
  );
  /*
    出し入れの欄に並べる順。表と同じ並びにしないと、動かした結果が読めない。
    **絞り込みにしか使わない列はここにも出さない。**表に出ない列なので、
    チェックを外しても何も変わらず、押しても効かない項目に見える
  */
  const orderedForPicker = applyColumnOrder(
    allColumns.filter((c) => !c.filterOnly),
    columnOrder,
  );
  /*
    隠している列の数え上げも、欄に出るものだけにする。
    以前に絞り込み専用の列を外した記録が端末に残っていると、
    欄に無いものを数えてしまい「隠している 1 件」が消せなくなる
  */
  const hiddenForPicker = new Set(
    orderedForPicker.filter((c) => hiddenColumns.has(c.key)).map((c) => c.key),
  );
  const { m } = useI18n();
  const ask = useConfirm();
  const prefs = usePageSizePrefs();
  /*
    並べる件数。**画面ごとの指定があればそれを、無ければその人の設定を使う。**
    いま選んでいる件数が並びに無いと、選択欄が別の値を指してしまうので足しておく
  */
  const sizes = pageSizeOptions ?? prefs.options;
  const shownSizes = sizes.includes(state.pageSize)
    ? sizes
    : [...sizes, state.pageSize].sort((a, b) => a - b);
  const { widthOf, setWidth, setWidths, resetWidths, hasCustomWidths } = useColumnWidths(
    `${storageKey}.widths`,
  );
  const { rowLines, setRowLines, resetRowLines, hasCustomRowLines } = useRowLines(
    `${storageKey}.rowLines`,
  );
  /** 中身なりの高さのときに、掴んだ時点の高さを測るため */
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  /*
    **無いページを指していたら、最後のページへ戻す。**
    ページ番号は表ごとに覚えているので、別の中身（別の法文物質名など）に切り替えたときや、
    行を消して件数が減ったときに「21 / 1」のような、空のページを見ていることがあった
  */
  useEffect(() => {
    if (rows === null) return;
    if (state.page > totalPages) onStateChange((prev) => ({ ...prev, page: totalPages }));
  }, [rows, state.page, totalPages, onStateChange]);

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
  /* 切れているセルは、マウスを置くと中身を全部出す */
  const peek = useTablePeek<HTMLDivElement>();
  const selectWidth =
    (selectable ? SELECT_COLUMN_WIDTH : 0) +
    (onReorder ? DRAG_COLUMN_WIDTH : 0) +
    (rowAction ? ACTION_COLUMN_WIDTH : 0);
  const dataSum = columns.reduce((sum, c) => sum + widthOf(c), 0);

  /*
    行の高さを変えるつまみ。見出しのいちばん左に1つだけ置く（表全体の高さを決めるため）。
    掴んだ時点の高さは、決めていなければ実際に描かれている高さを測る。
    そうしないと、掴んだ瞬間に行が飛んで、カーソルと合わなくなる
  */
  const rowHandle = (
    <RowResizeHandle
      label={m.table.resizeRows}
      current={() =>
        rowLines === null
          ? measuredRowHeight(bodyRef.current?.querySelector("tr"))
          : rowHeightOf(rowLines)
      }
      onResize={(px) => setRowLines(rowLinesOf(px))}
    />
  );
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

  /** 別の画面へ移るあいだ、押せたことが分かるようカーソルを砂時計にする */
  function markBusy() {
    document.body.classList.add("cursor-busy");
    if (busyTimer.current !== null) window.clearTimeout(busyTimer.current);
    busyTimer.current = window.setTimeout(
      () => document.body.classList.remove("cursor-busy"),
      10_000,
    );
  }

  /** 行の右端に出す絵。指定が無ければ編集の鉛筆 */
  const RowActionIcon = rowAction?.icon ?? Pencil;

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

  /* 選ばれている行を外へ。**表の中の並びで返す**ので、押した順ではない */
  const selectedRows = (rows ?? []).filter((r) => selected.has(rowKey(r)));
  const selectedKeys = selectedRows.map(rowKey).join(",");
  useEffect(() => {
    onSelectionChange?.(selectedRows);
    // 中身が同じなら知らせ直さない（毎回の描き直しで無限に呼ばれる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeys]);

  async function runBulkAction() {
    const targets = (rows ?? []).filter((r) => selected.has(rowKey(r)));
    if (targets.length === 0 || !bulkAction) return;
    if (bulkAction.confirm && !(await ask({ message: bulkAction.confirm(targets.length) }))) return;
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
    if (!(await ask({ message: m.table.deleteSelectedConfirm(targets.length), destructive: true })))
      return;
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

  const colSpan = columns.length + (selectable ? 1 : 0) + (onReorder ? 1 : 0) + (rowAction ? 1 : 0);

  /**
   * 1ページの件数。上と下の両方に置くので、作り方を1つにまとめる。
   * **何の数字かを名前で添える。**数だけだと、ページ番号と見分けが付かない
   */
  const pageSizeSelect = showPager ? (
    <label className="flex items-center gap-1 whitespace-nowrap">
      {m.table.pageSize}
      <select
        aria-label={m.table.pageSize}
        value={state.pageSize}
        onChange={(e) =>
          onStateChange((prev) => ({ ...prev, pageSize: Number(e.target.value), page: 1 }))
        }
        className="border-input bg-background h-8 rounded-none border px-1 text-xs"
      >
        {shownSizes.map((n) => (
          <option key={n} value={n}>
            {m.table.perPage(n)}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  /*
    ページ送りは**上にも置く。**行が多いと、めくるためだけに下まで送ることになる。
    置く場所は操作の行の右端。行を増やすと、そのぶん表が下へ押される。
    1ページで終わるときは出さない（押す先が無い）
  */
  const topPager = showPager ? (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      {/* 件数も上に置く。下まで送らずに「もっと出す」ができる */}
      {pageSizeSelect}
      {totalPages > 1 && (
        <Pager
          page={state.page}
          totalPages={totalPages}
          onJump={(page) => onStateChange((prev) => ({ ...prev, page }))}
        />
      )}
    </div>
  ) : null;

  /**
   * 表の操作。左から「新規登録（＋）→ その表だけのボタン → ごみ箱」の順に並べる。
   * フィルターと同じ1行に置くので、行が2段になって空白の帯ができることがない。
   */
  const actions =
    title || create || selectable || bulkAction || headerActions ? (
      <div className="flex flex-wrap items-center gap-2">
        {title && <h2 className={TABLE_TITLE}>{title}</h2>}
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
        {/* 消せる表にだけ出す。選ぶ目的が「消す」以外の表もある（帳票の相手を選ぶなど） */}
        {selectable && onDeleteSelected && (
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
            variant={bulkAction.primary ? "default" : "outline"}
            size="sm"
            disabled={selected.size === 0 || deleting}
            onClick={() => void runBulkAction()}
          >
            <CircleCheck className="mr-1 size-3.5" />
            {bulkAction.label}
            {selected.size > 0 && `（${selected.size}）`}
          </Button>
        )}
        {selected.size > 0 && (
          <span className="text-muted-foreground text-sm">
            {m.table.selectedCount(selected.size)}
          </span>
        )}
      </div>
    ) : null;

  // 掘る動作は目に見えないので、表ごとの言葉があればそれを出す
  const hint = hintText ? <span className="text-muted-foreground text-xs">{hintText}</span> : null;

  return (
    /*
      操作の並びと表の間は詰める。枠を外したぶん、離れて見えてしまう
    */
    <div className="space-y-1.5">
      {showFilters ? (
        <FilterPanel
          columns={allColumns}
          orderedColumns={orderedForPicker}
          hiddenColumns={hiddenForPicker}
          onToggleColumn={toggleColumn}
          onMoveColumn={(key, dir) =>
            moveColumn(
              columns.map((c) => c.key),
              key,
              dir,
            )
          }
          onResetColumns={resetColumns}
          columnsChanged={columnsChanged}
          state={state}
          defaultState={defaultState}
          onFilterChange={setFilter}
          onReset={onReset}
          storageKey={`${storageKey}.filterPanel`}
          filterLayout={filterLayout}
          actions={actions}
          trailing={topPager ?? hint}
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
        (actions || hint || topPager) && (
          <div className="bg-background flex flex-wrap items-center gap-2">
            {actions}
            {(topPager ?? hint) && <div className="ml-auto">{topPager ?? hint}</div>}
          </div>
        )
      )}

      <div
        ref={(el) => {
          scrollerRef.current = el;
          peek.attach(el);
        }}
        className="bg-background overflow-x-auto rounded-md border"
      >
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
            {rowAction && <col style={{ width: ACTION_COLUMN_WIDTH }} />}
          </colgroup>
          {/*
            テーマによっては濃い色が敷かれる。中の文字色は table-head-foreground に従わせる。
            th は既定で text-foreground を持つので、打ち消して継承させる。
          */}
          <TableHeader className="bg-table-head text-table-head-foreground [&_th]:text-inherit">
            <TableRow>
              {/* つかむ場所の列。見出しは要らない */}
              {onReorder && (
                <TableHead className={cn("relative", CELL_BORDER, SELECT_CELL)}>
                  {rowHandle}
                </TableHead>
              )}
              {selectable && (
                <TableHead className={cn("relative", CELL_BORDER, SELECT_CELL)}>
                  {!onReorder && rowHandle}
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
                    {i === 0 && !onReorder && !selectable && rowHandle}
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
                      /*
                        いちばん右のセルのつまみは、外へはみ出さないように内側へ寄せる。
                        はみ出したままだと、表が枠にぴったり収まっていても
                        そのぶん（6px）幅が余り、**要らない横スクロールバーが出る**
                      */
                      last={!neighbor && !rowAction}
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
              {/* 編集の列。見出しは要らない */}
              {rowAction && <TableHead className={cn(CELL_BORDER, SELECT_CELL)} />}
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
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
                    onRowSelect && "cursor-pointer",
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
                  {columns.map((c) => {
                    /*
                      何行で打ち切るか。
                      列の指定が先で、無ければ利用者が決めた行の高さに従う。
                      どちらも無ければ打ち切らない（今までどおり中身なりの高さ）
                    */
                    const clamp = c.clampLines ?? rowLines;
                    return (
                      <TableCell
                        key={c.key}
                        // 高さを決めたら、中身によらず同じ高さにする
                        style={rowLines === null ? undefined : { height: rowHeightOf(rowLines) }}
                        className={cn(
                          // 高さを決めたときは、増えた行に続きを流し込むため折り返す
                          c.multiline || rowLines !== null
                            ? "align-top break-words whitespace-normal"
                            : "truncate",
                          CELL_BORDER,
                          c.className,
                        )}
                      >
                        {/* 打ち切る行数が決まっていたら、その行数で止めて「…」を出す */}
                        {clamp ? (
                          <div
                            className="overflow-hidden"
                            style={{
                              display: "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: clamp,
                            }}
                          >
                            {c.render?.(row)}
                          </div>
                        ) : (
                          c.render?.(row)
                        )}
                      </TableCell>
                    );
                  })}
                  {rowAction && (
                    <TableCell className={cn(CELL_BORDER, SELECT_CELL)}>
                      <button
                        type="button"
                        disabled={rowAction.disabled?.(row) ?? false}
                        title={rowAction.label ?? m.common.edit}
                        aria-label={rowAction.label ?? m.common.edit}
                        // 押したときに行のシングルクリック（掘る動作）を起こさない
                        onClick={(e) => {
                          e.stopPropagation();
                          if (rowAction.busy) markBusy();
                          rowAction.onClick(row);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground mx-auto flex size-6 items-center justify-center rounded transition-colors disabled:opacity-30"
                      >
                        <RowActionIcon className="size-3.5" />
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {peek.node}

      {/* ページ送りを出さない表でも、見た目を変えていれば戻す口だけは残す */}
      {(showPager || hasCustomWidths || hasCustomRowLines) && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            {showPager && <span>{m.common.totalCount(total)}</span>}
            {pageSizeSelect}
            {hasCustomWidths && (
              <Button variant="ghost" size="sm" onClick={resetWidths}>
                {m.table.resetWidths}
              </Button>
            )}
            {hasCustomRowLines && (
              <Button variant="ghost" size="sm" onClick={resetRowLines}>
                {m.table.resetRowHeight}
              </Button>
            )}
          </div>
          {showPager && (
            <Pager
              page={state.page}
              totalPages={totalPages}
              onJump={(page) => onStateChange((prev) => ({ ...prev, page }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ページ送り。**表の上と下の両方に置く。**
 * 行が多いと、めくるためだけに下まで送ることになる
 */
function Pager({
  page,
  totalPages,
  onJump,
}: {
  page: number;
  totalPages: number;
  onJump: (page: number) => void;
}) {
  const { m } = useI18n();
  return (
    <div className="flex items-center gap-1">
      {/*
        **2ページ以上あるときだけ「最初」「最後」を出す。**
        1ページで終わる一覧に4つ並べても押すところが無い
      */}
      {totalPages > 2 && (
        <Button
          variant="outline"
          size="icon-sm"
          title={m.table.firstPage}
          aria-label={m.table.firstPage}
          disabled={page <= 1}
          onClick={() => onJump(1)}
        >
          <ChevronsLeft className="size-4" />
        </Button>
      )}
      {/*
        送りのボタンは記号だけにする。**読み上げには言葉を残す**
        （記号だけでは、耳で聞いている人に何のボタンか分からない）
      */}
      <Button
        variant="outline"
        size="sm"
        title={m.table.prevPage}
        aria-label={m.table.prevPage}
        disabled={page <= 1}
        onClick={() => onJump(page - 1)}
      >
        {m.table.prevMark}
      </Button>
      <PageJump page={page} totalPages={totalPages} onJump={onJump} />
      <Button
        variant="outline"
        size="sm"
        title={m.table.nextPage}
        aria-label={m.table.nextPage}
        disabled={page >= totalPages}
        onClick={() => onJump(page + 1)}
      >
        {m.table.nextMark}
      </Button>
      {totalPages > 2 && (
        <Button
          variant="outline"
          size="icon-sm"
          title={m.table.lastPage}
          aria-label={m.table.lastPage}
          disabled={page >= totalPages}
          onClick={() => onJump(totalPages)}
        >
          <ChevronsRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * 何ページ以上で「直接ページを指定する」口を出すか。
 * **2ページあれば出す。**「次へ」を押していく代わりに、いつでも数で選べる
 */
const PAGE_JUMP_FROM = 2;

/**
 * ページの指定。
 *
 * 「次へ」を押していくと、離れたページには着けない。
 * **2ページ以上あれば、数で選べるようにする。**
 *
 * **一覧から選ぶ。**打ち込む形も試したが、
 * 打ってから確定するまでの手数が増えるだけだった。
 */
function PageJump({
  page,
  totalPages,
  onJump,
}: {
  page: number;
  totalPages: number;
  onJump: (page: number) => void;
}) {
  const { m } = useI18n();

  /*
    ページの並びは**ページ数が変わったときだけ作り直す。**
    数千ページになる表があるので、描き直すたびに作ると重くなる
  */
  const pages = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  // 1ページしかないときは、選ばせても行き先が無い
  if (totalPages < PAGE_JUMP_FROM) {
    return <span className="px-1">{m.common.pageOf(page, totalPages)}</span>;
  }

  return (
    <span className="flex items-center gap-1 px-1">
      <select
        aria-label={m.table.jumpToPage}
        value={page}
        onChange={(e) => onJump(Number(e.target.value))}
        className="border-input bg-background h-8 rounded-none border px-1 text-xs"
      >
        {pages.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      / {totalPages}
    </span>
  );
}
