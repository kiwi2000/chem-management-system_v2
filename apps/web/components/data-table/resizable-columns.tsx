"use client";

import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTablePeek } from "./cell-peek";
import { useColumnWidths } from "./use-column-widths";
import { rowHeightOf, rowLinesOf, useRowLines } from "./use-row-lines";
import { MIN_COLUMN_WIDTH, ROW_LINE_HEIGHT, ROW_PADDING } from "./types";

/**
 * 手で組んだ表にも、一覧と同じ「列幅をドラッグで変えられる」仕組みを付ける。
 *
 * 一覧（`DataTable`）は列の定義から表そのものを組み立てるが、
 * 判定表や組成表は行の作りが特殊で（1行の中を分けたり、下に内訳を差し込んだり）
 * 列の定義だけでは組み立てられない。**幅の扱いだけを持ち出して共通にする。**
 *
 * 挙動は一覧とそろえる。合わないと、同じ画面の中で表ごとに操作感が変わる。
 *
 *   ・見出しの右端をドラッグ（矢印キーでも動く。Shift で大きく）
 *   ・広げたぶんは**隣の列からもらう**（合計が変わらないので掴んだ位置がずれない）
 *   ・変えた幅は端末に覚える（見た目の好みなので URL には載せない）
 *   ・幅は比率で置くので、画面が狭ければ同じ割合で詰まる
 *
 * 使いかた:
 *
 * ```tsx
 * const cols = useResizableColumns("chem.table.xxx", [
 *   { key: "code", width: 112 },
 *   { key: "name", width: 288 },
 * ]);
 * <div ref={cols.scrollerRef} className="overflow-x-auto">
 *   <table className="table-fixed" style={{ minWidth: cols.minTableWidth }}>
 *     <colgroup>{cols.cols()}</colgroup>
 *     <thead><tr>
 *       <th className="relative">コード{cols.handle("code", "コード")}</th>
 * ```
 */

export interface ResizableColumn {
  key: string;
  /** 既定の幅（px）。利用者が変えるまでこの幅で描く */
  width: number;
}

export interface ResizableOptions {
  /**
   * 画面より広いときに、列を詰めて収めるか。
   *
   * 既定は詰める（一覧と同じ）。余白があるのに横スクロールバーが出るのを避けるため。
   *
   * **列の数が中身で増える表は false にする。**
   * 詰める側だと、列が増えるほど1列ずつ細くなり、見出しが読めなくなる。
   * false なら幅は変わらず、はみ出したぶんだけ横に送る。
   */
  shrinkToFit?: boolean;
  /**
   * 左に貼り付ける列の数（先頭から数える）。
   *
   * 横に送っても、いま見ている行がどの物質のものかを見失わないため。
   * 貼り付ける列の背景は、呼ぶ側で**不透明**にすること。
   * 0 なら貼り付けない（既定）。
   */
  frozen?: number;
  /**
   * 行の高さを変えるつまみに読ませる名前。
   * この中では画面の文言を読めないので、呼ぶ側から渡す（`m.table.resizeRows`）。
   */
  rowLabel?: string;
}

export function useResizableColumns(
  storageKey: string,
  columns: ResizableColumn[],
  { shrinkToFit = true, frozen = 0, rowLabel = "" }: ResizableOptions = {},
) {
  const inner = useRef<HTMLDivElement>(null);
  /*
    切れているセルは、マウスを置くと中身を全部出す。**一覧と同じ動き。**
    表を包む枠に付けるだけなので、セルの側は何も変えなくてよい
  */
  const peek = useTablePeek<HTMLDivElement>();
  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    inner.current = el;
    peek.attach(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { widthOf, setWidth, setWidths, resetWidths, hasCustomWidths } = useColumnWidths(
    `${storageKey}.widths`,
  );
  const { rowLines, setRowLines, resetRowLines } = useRowLines(`${storageKey}.rowLines`);

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const sum = columns.reduce((acc, c) => acc + widthOf(c), 0);
  /*
    比率で置く。合計が表示領域より広いときは全体を同じ割合で詰めるので、
    余白があるのに横スクロールバーが出る、という状態にならない。
    ただし詰めすぎると読めないので、min-width より狭くはしない。
  */
  const minTableWidth = shrinkToFit ? Math.min(sum, MIN_COLUMN_WIDTH * columns.length) : sum;

  /*
    **左に貼り付ける列。**横に送っても、いま見ている行がどの物質のものかを見失わないため。
    左からの距離は、前に並ぶ列の幅を足したもの。幅と同じ値から毎回作るので、
    つまみで幅を変えても一緒に動く（ずれない）。
  */
  const frozenLeft: number[] = [];
  for (let i = 0, at = 0; i < frozen && i < columns.length; i++) {
    frozenLeft.push(at);
    at += widthOf(columns[i]!);
  }
  const frozenWidth =
    frozenLeft.length > 0
      ? frozenLeft[frozenLeft.length - 1]! + widthOf(columns[frozenLeft.length - 1]!)
      : 0;

  /**
   * 貼り付ける列に渡す見た目。貼り付けない列には何も返さない。
   *
   * 背景は**呼ぶ側で必ず不透明にすること。**透けると、下を流れていく列が見えてしまう。
   * 境目の線は影で引く。`border-collapse` の表では、線がセルと一緒に動かないため。
   */
  const frozenProps = (index: number) => {
    const left = frozenLeft[index];
    if (left === undefined) return {};
    const last = index === frozenLeft.length - 1;
    return {
      style: { position: "sticky" as const, left, zIndex: 10 },
      "data-frozen": last ? "last" : "yes",
      className: last ? "shadow-[inset_-1px_0_0_0_var(--border)]" : undefined,
    };
  };

  /**
   * 貼り付ける部分を広げすぎて、流れる部分が無くなるのを防ぐ。
   * 見えている幅の6割までとする（引くとそこで止まる）。
   */
  const frozenRoom = (key: string) => {
    const at = columns.findIndex((c) => c.key === key);
    if (frozen === 0 || at < 0 || at >= frozen) return Infinity;
    const el = inner.current;
    if (!el) return Infinity;
    /*
      **表が枠に収まっているうちは止めない。**流れる部分が無くなるのを防ぐための
      決まりなので、そもそも流れていないなら止める理由が無い。
      右の余りを使い切って表がはみ出したところで、下の6割で止まる
    */
    if (el.clientWidth >= sum) return Infinity;
    const now = widthOf(columns[at]!);
    /*
      **いまの幅より狭くはしない。**画面が狭くて既に6割を超えているとき、
      広げようと掴んだ瞬間に縮むと、掴んだ場所とカーソルが合わなくなる。
      ここで止めるのは「これ以上広げること」だけ。狭めるのは今までどおりできる
    */
    return Math.max(now, el.clientWidth * 0.6 - frozenWidth + now);
  };

  /**
   * 表を包む枠に渡すもの。行の高さを決めていないときは何も渡さない
   * （渡さなければ、今までどおり中身なりの高さになる）。
   */
  const rowProps =
    rowLines === null
      ? {}
      : {
          "data-row-lines": rowLines,
          style: {
            "--row-h": `${rowHeightOf(rowLines)}px`,
            "--row-lines": rowLines,
          } as CSSProperties,
        };

  /**
   * 行の高さを変えるつまみ。**表のいちばん左の見出しに置く**
   * （置く `th` に `relative` を付けること）。両押しで元に戻す。
   */
  const rowHandle = () => (
    <RowResizeHandle
      label={rowLabel}
      current={() =>
        rowLines === null
          ? measuredRowHeight(inner.current?.querySelector("tbody tr"))
          : rowHeightOf(rowLines)
      }
      onResize={(px) => setRowLines(rowLinesOf(px))}
      onReset={resetRowLines}
    />
  );

  /**
   * 指定した幅と、実際に描かれる幅の比。ドラッグは画面上の px で動くので戻すのに要る。
   *
   * **詰めない表は必ず 1。**幅を px でそのまま指定して描いているので、
   * 指定と実際が食い違わない。ここで枠の広さから割ると、右が余っているときに
   * 1より大きくなり、**掴んだ瞬間に列が飛んでいた**
   */
  const scale = useCallback(() => {
    if (!shrinkToFit) return 1;
    const el = inner.current;
    if (!el || sum === 0) return 1;
    return Math.max(el.clientWidth, minTableWidth) / sum;
  }, [sum, minTableWidth, shrinkToFit]);

  /**
   * 表の右に余っている幅。
   *
   * 詰めない表は中身の幅で止めるので、列が少ないと右が余る。
   * **余っているあいだは、広げても隣から取らない。**そのぶん表そのものが伸びる。
   * 詰める表は必ず枠いっぱいなので、余りは無い。
   */
  const roomOnRight = useCallback(() => {
    if (shrinkToFit) return 0;
    const el = inner.current;
    return el ? Math.max(0, el.clientWidth - sum) : 0;
  }, [sum, shrinkToFit]);

  /**
   * `<colgroup>` の中身。
   *
   * 詰める表は**比率**で置く（画面に合わせて全体が伸び縮みする）。
   * 詰めない表は**そのままの px** で置く。比率にすると、列が少ないときに
   * 1列が画面いっぱいまで伸びて、「6」の1文字に何百pxも取られる。
   */
  const cols = () =>
    columns.map((c) => (
      <col
        key={c.key}
        style={{
          width: shrinkToFit
            ? `${(sum === 0 ? 0 : (widthOf(c) / sum) * 100).toFixed(4)}%`
            : widthOf(c),
        }}
      />
    ));

  /**
   * `<table>` に渡すもの。
   *
   * 詰める表は画面いっぱいに広げる。
   * 詰めない表は**内容に合わせた幅で止める**。右が余ってもよい。
   * いちばん右の列のつまみを引けば、そのぶん表が伸びる。
   */
  const tableProps = {
    className: shrinkToFit ? "w-full" : "",
    style: shrinkToFit ? { minWidth: minTableWidth } : { width: sum },
  };

  /**
   * 見出しに置くつまみ。**置く `th` に `relative` を付けること**（右端に貼り付くため）。
   *
   * 広げたぶんは、まず**表の右の余り**から取る（表が伸びる）。
   * 余りを使い切ってから、隣の列からもらう（合計が変わらないので掴んだ位置がずれない）。
   * いちばん右の列は隣が無いので、いつでも表全体が広がる。
   */
  const handle = (key: string, label: string): ReactNode => {
    const col = byKey.get(key);
    if (!col) return null;
    const at = columns.findIndex((c) => c.key === key);
    const neighbor = columns[at + 1];
    return (
      <ResizeHandle
        label={label}
        // いちばん右の列だけは、外にはみ出さない置き方にする（下の説明を読むこと）
        last={!neighbor}
        current={() => widthOf(col) * scale()}
        onResize={(px) => {
          // 貼り付ける列は、広げすぎると流れる部分が無くなる。そこで止める
          const want = Math.min(px / scale(), frozenRoom(key));
          if (!neighbor) return setWidth(key, want);
          const delta = want - widthOf(col);
          /*
            **右が余っているあいだは、隣から取らない。**表そのものが伸び縮みする。
            狭めるときも（`delta` が負のときも）ここを通るので、
            引いたぶんはそのまま余りに戻る
          */
          const slack = roomOnRight();
          if (delta <= slack) return setWidth(key, want);
          // 余りを使い切ったぶんだけ、隣からもらう。隣を最小幅より狭くはしない
          const room = Math.max(0, widthOf(neighbor) - MIN_COLUMN_WIDTH);
          const move = Math.min(delta - slack, room);
          setWidths({
            [key]: widthOf(col) + slack + move,
            [neighbor.key]: widthOf(neighbor) - move,
          });
        }}
      />
    );
  };

  return {
    scrollerRef,
    rowProps,
    rowHandle,
    /** 吹き出しの置き場所。表を出しているところで1回だけ描くこと */
    peek: peek.node,
    minTableWidth,
    tableProps,
    cols,
    handle,
    resetWidths,
    hasCustomWidths,
    widthOf,
    frozenProps,
  };
}

/**
 * 列幅を変えるつまみ。見出しの右端をドラッグする。
 * キーボードでも矢印キーで変えられるようにしている（Shift で大きく動く）。
 */
export function ResizeHandle({
  label,
  last = false,
  current,
  onResize,
}: {
  label: string;
  /**
   * いちばん右の列か。
   *
   * **右端だけは、外へはみ出さないように内側へ寄せる。**
   * はみ出したままだと、表が枠にぴったり収まっていても、そのぶん（6px）だけ
   * 幅が余っていることになり、**要らない横スクロールバーが出る**
   */
  last?: boolean;
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
      /*
        **境目をまたいで置く。**内側だけに置くと、目に見えている線をねらったとき
        半分が隣の列に外れて掴めない。幅も6pxでは細いので、指でもねらえる太さにする。
        隣のセルの上に重ねるので、前に出しておく
      */
      className={cn(
        "hover:bg-primary/40 focus-visible:bg-primary/40 absolute top-0 z-20 h-full w-3 cursor-col-resize touch-none select-none",
        last ? "right-0" : "-right-1.5",
      )}
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

/**
 * 行の高さを変えるつまみ。**見出しの下端を下へドラッグする。**
 *
 * 列幅のつまみ（`ResizeHandle`）と作りをそろえてある。向きだけが違う。
 * 動きは1行ぶんずつで、中途半端な高さにはならない
 * （字の大きさが列ごとに違うので、px で持つと切れる位置がそろわない）。
 *
 * **置く `th` に `relative` を付けること**（下端に貼り付くため）。
 */
export function RowResizeHandle({
  label,
  current,
  onResize,
  onReset,
}: {
  label: string;
  /** いまの行の高さ（px） */
  current: () => number;
  /** 変えたい高さ（px）。受け取る側で行数に直す */
  onResize: (px: number) => void;
  /** 両押しで元に戻す。決めた高さを捨て、中身なりの高さへ */
  onReset?: () => void;
}) {
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      /*
        見出しの下端をまたいで置く。列幅のつまみと重なるのは右端の数pxだけで、
        あちらが前（z-20）なので、掴み分けられる
      */
      className="hover:bg-primary/40 focus-visible:bg-primary/40 absolute -bottom-1 left-0 z-10 h-2 w-full cursor-row-resize touch-none select-none"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startY: e.clientY, startHeight: current() };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onResize(drag.current.startHeight + (e.clientY - drag.current.startY));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={(e) => {
        // 1回で1行ぶん。Shift で3行ぶん
        const step = (e.shiftKey ? 3 : 1) * ROW_LINE_HEIGHT;
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onResize(current() - step);
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onResize(current() + step);
        }
      }}
    />
  );
}

/** 中身なりの高さのときに、いまの行の高さを測る。つまみを掴んだ場所からずれないように */
export function measuredRowHeight(row: HTMLElement | null | undefined) {
  return row?.getBoundingClientRect().height ?? ROW_LINE_HEIGHT + ROW_PADDING;
}
