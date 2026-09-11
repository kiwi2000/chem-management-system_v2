"use client";

import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/** これより低くはしない。見出しと数行は見えるように */
const MIN_HEIGHT = 120;
/** 画面より高くはしない（下端のつまみが画面の外へ出ると戻せない） */
const MARGIN_BELOW = 40;
/** 矢印キー1回で動く量（Shift で4倍） */
const KEY_STEP = 24;

/**
 * 高さを変えられる、中で送る箱。
 *
 * 表を箱の中で送る画面（組成のまとめ表・組成の編集・判定・物質の一覧表）は、
 * 高さを画面の 70% に決めてあった。**枠（カード）の下端の線をドラッグすると高さが変わる。**
 * つまみは箱の中ではなく、箱を包むカードの下辺に置く（利用者が掴みたいのはそこ。2026-09-11）。
 * カードの中に無いときは、箱そのものの下端に置く。
 * 変えた高さは端末に覚える（列幅・行の高さと同じ扱い。見た目の好みなので URL には載せない）。
 * 2回押すと元（既定の高さ）に戻る。矢印キーでも変えられる。
 *
 * 何も変えていないあいだは `max-height`（中身が少なければ箱も低い）。
 * 変えたあとは `height`（決めた高さのまま。中身が少なくても空きができる）。
 *
 * 中の `div` に `ref`（列幅の仕組みの `scrollerRef`）と、行の高さの `rowProps` を渡せる。
 */
export function ResizableBox({
  storageKey,
  scrollerRef,
  defaultMaxHeight = "70vh",
  className,
  children,
  ...rest
}: {
  /** 高さを覚える鍵。画面ごとに変える（`chem.box.…`） */
  storageKey: string;
  /** 中で送る `div` に付ける ref（`useResizableColumns` の `scrollerRef`） */
  scrollerRef?: (el: HTMLDivElement | null) => void;
  /**
   * 何も変えていないときの高さの上限（CSS の値）。既定は画面の 70%。
   * `null` なら上限を決めない（一覧の画面。ページごと送るのが既定で、引いたときだけ箱になる）
   */
  defaultMaxHeight?: string | null;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const { m } = useI18n();
  const [height, setHeight] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  /**
   * つまみを置く場所（包んでいるカードの下辺）。包みからの相対位置。
   * カードの中に無ければ null で、箱の下端に置く
   */
  const [edge, setEdge] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setHeight(clamp(Number(saved)));
    } catch {
      // 壊れた値が入っていたら既定の高さで始める
    }
  }, [storageKey]);

  const apply = useCallback(
    (px: number) => {
      const next = clamp(px);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // 覚えられなくても、いまの画面では効かせる
      }
      setHeight(next);
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // 消せなくても、いまの画面では戻す
    }
    setHeight(null);
  }, [storageKey]);

  /*
    カードの下辺の位置を測る。箱の高さが変わるたび、カードの中身が変わるたびに測り直す。
    カードの余白の大きさに頼らないので、どの画面でも同じ部品で済む
  */
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const box = boxRef.current;
    if (!wrap || !box) return;
    const card = box.closest<HTMLElement>('[data-slot="card"]');
    if (!card) {
      setEdge(null);
      return;
    }
    const measure = () => {
      const w = wrap.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      setEdge({ top: c.bottom - w.top, left: c.left - w.left, width: c.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    ro.observe(box);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [height]);

  /** いまの高さ（px）。既定のままのときは実際に描かれている高さを測る */
  const current = () => boxRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT;

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef.current = el;
      scrollerRef?.(el);
    },
    [scrollerRef],
  );

  return (
    <div ref={wrapRef} className="relative">
      <div
        ref={setRefs}
        className={cn("overflow-auto", className)}
        style={
          height === null
            ? defaultMaxHeight
              ? { maxHeight: defaultMaxHeight }
              : undefined
            : { height }
        }
        {...rest}
      >
        {children}
      </div>
      {/*
        つまみは**カードの下辺の線そのもの**。列幅・行の高さのつまみ（resizable-columns.tsx）と同じく、
        線をまたいで置き、見た目には線しか無い（掴むと線が色づく）。
        カードの外に出るので、包みの `relative` からの位置で置く
      */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={m.table.resizeHeight}
        title={m.table.resizeHeight}
        tabIndex={0}
        className={cn(
          "hover:bg-primary/40 focus-visible:bg-primary/40 absolute z-10 h-2 cursor-row-resize touch-none select-none outline-none",
          edge === null && "-bottom-1 left-0 w-full",
        )}
        style={edge ? { top: edge.top - 4, left: edge.left, width: edge.width } : undefined}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startY: e.clientY, startHeight: current() };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          apply(drag.current.startHeight + (e.clientY - drag.current.startY));
        }}
        onPointerUp={(e) => {
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onDoubleClick={reset}
        onKeyDown={(e) => {
          const step = (e.shiftKey ? 4 : 1) * KEY_STEP;
          if (e.key === "ArrowUp") {
            e.preventDefault();
            apply(current() - step);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            apply(current() + step);
          }
        }}
      />
    </div>
  );
}

function clamp(px: number) {
  if (!Number.isFinite(px)) return MIN_HEIGHT;
  const max = typeof window === "undefined" ? 2000 : window.innerHeight - MARGIN_BELOW;
  return Math.min(Math.max(MIN_HEIGHT, max), Math.max(MIN_HEIGHT, Math.round(px)));
}
