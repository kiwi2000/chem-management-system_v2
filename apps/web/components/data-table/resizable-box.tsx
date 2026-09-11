"use client";

import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
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
 * 高さを画面の 70% に決めてあった。**箱の下端の線をドラッグすると高さが変わる。**
 * 変えた高さは端末に覚える（列幅・行の高さと同じ扱い。見た目の好みなので URL には載せない）。
 * 2回押すと元（画面の 70%）に戻る。矢印キーでも変えられる。
 *
 * 何も変えていないあいだは `max-height`（中身が少なければ箱も低い）。
 * 変えたあとは `height`（決めた高さのまま。中身が少なくても空きができる）。
 *
 * 中の `div` に `ref`（列幅の仕組みの `scrollerRef`）と、行の高さの `rowProps` を渡せる。
 */
export function ResizableBox({
  storageKey,
  scrollerRef,
  className,
  children,
  ...rest
}: {
  /** 高さを覚える鍵。画面ごとに変える（`chem.box.…`） */
  storageKey: string;
  /** 中で送る `div` に付ける ref（`useResizableColumns` の `scrollerRef`） */
  scrollerRef?: (el: HTMLDivElement | null) => void;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const { m } = useI18n();
  const [height, setHeight] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

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
    <div className="relative">
      <div
        ref={setRefs}
        className={cn("overflow-auto", className)}
        style={height === null ? { maxHeight: "70vh" } : { height }}
        {...rest}
      >
        {children}
      </div>
      {/*
        つまみは**箱の下端の線そのもの**。列幅・行の高さのつまみ（resizable-columns.tsx）と同じく、
        境目の線をまたいで置き、見た目には線しか無い（掴むと線が色づく）。
        別に段を作らないので、表の下に余計な帯が出ない
      */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={m.table.resizeHeight}
        title={m.table.resizeHeight}
        tabIndex={0}
        className="hover:bg-primary/40 focus-visible:bg-primary/40 absolute -bottom-1 left-0 z-10 h-2 w-full cursor-row-resize touch-none select-none outline-none"
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
