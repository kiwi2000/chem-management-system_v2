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

export function useResizableColumns(storageKey: string, columns: ResizableColumn[]) {
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
  const minTableWidth = Math.min(sum, MIN_COLUMN_WIDTH * columns.length);

  /** 指定した幅と、実際に描かれる幅の比。ドラッグは画面上の px で動くので戻すのに要る */
  const scale = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || sum === 0) return 1;
    return Math.max(el.clientWidth, minTableWidth) / sum;
  }, [sum, minTableWidth]);

  /** `<colgroup>` の中身 */
  const cols = () =>
    columns.map((c) => (
      <col
        key={c.key}
        style={{ width: `${(sum === 0 ? 0 : (widthOf(c) / sum) * 100).toFixed(4)}%` }}
      />
    ));

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

  return { scrollerRef, minTableWidth, cols, handle, resetWidths, hasCustomWidths, widthOf };
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
