"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { useColumnWidths } from "./use-column-widths";
import { MIN_COLUMN_WIDTH } from "./types";

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
}

export function useResizableColumns(
  storageKey: string,
  columns: ResizableColumn[],
  { shrinkToFit = true }: ResizableOptions = {},
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { widthOf, setWidth, setWidths, resetWidths, hasCustomWidths } = useColumnWidths(
    `${storageKey}.widths`,
  );

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const sum = columns.reduce((acc, c) => acc + widthOf(c), 0);
  /*
    比率で置く。合計が表示領域より広いときは全体を同じ割合で詰めるので、
    余白があるのに横スクロールバーが出る、という状態にならない。
    ただし詰めすぎると読めないので、min-width より狭くはしない。
  */
  const minTableWidth = shrinkToFit ? Math.min(sum, MIN_COLUMN_WIDTH * columns.length) : sum;

  /** 指定した幅と、実際に描かれる幅の比。ドラッグは画面上の px で動くので戻すのに要る */
  const scale = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || sum === 0) return 1;
    return Math.max(el.clientWidth, minTableWidth) / sum;
  }, [sum, minTableWidth]);

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
   * いちばん右の列は隣が無いので、そのぶんだけ表全体が広がる。
   */
  const handle = (key: string, label: string): ReactNode => {
    const col = byKey.get(key);
    if (!col) return null;
    const at = columns.findIndex((c) => c.key === key);
    const neighbor = columns[at + 1];
    return (
      <ResizeHandle
        label={label}
        current={() => widthOf(col) * scale()}
        onResize={(px) => {
          const want = px / scale();
          if (!neighbor) return setWidth(key, want);
          const delta = want - widthOf(col);
          // 隣を最小幅より狭くはしない。そこで止まる
          const room = widthOf(neighbor) - MIN_COLUMN_WIDTH;
          const move = Math.min(delta, room);
          setWidths({ [key]: widthOf(col) + move, [neighbor.key]: widthOf(neighbor) - move });
        }}
      />
    );
  };

  return {
    scrollerRef,
    minTableWidth,
    tableProps,
    cols,
    handle,
    resetWidths,
    hasCustomWidths,
    widthOf,
  };
}

/**
 * 列幅を変えるつまみ。見出しの右端をドラッグする。
 * キーボードでも矢印キーで変えられるようにしている（Shift で大きく動く）。
 */
export function ResizeHandle({
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
      /*
        **境目をまたいで置く。**内側だけに置くと、目に見えている線をねらったとき
        半分が隣の列に外れて掴めない。幅も6pxでは細いので、指でもねらえる太さにする。
        隣のセルの上に重ねるので、前に出しておく
      */
      className="hover:bg-primary/40 focus-visible:bg-primary/40 absolute top-0 -right-1.5 z-20 h-full w-3 cursor-col-resize touch-none select-none"
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
