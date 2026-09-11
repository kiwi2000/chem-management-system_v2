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
import { createPortal } from "react-dom";
import { EdgeHandle, clampHeight, useRegisterCardBox } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/** これより低くはしない。見出しと数行は見えるように */
const MIN_HEIGHT = 120;

/**
 * 高さを変えられる、中で送る箱。
 *
 * 表を出す画面はどれも、**表を包むカードの下辺の線をドラッグすると表の高さが変わる**
 * （利用者が掴みたいのはカードの縁。2026-09-11）。カードの中に無いときは、箱そのものの下端に置く。
 * 変えた高さは端末に覚える（列幅・行の高さと同じ扱い。見た目の好みなので URL には載せない）。
 * 2回押すと元（既定の高さ）に戻る。矢印キーでも変えられる。
 *
 * 何も変えていないあいだは `max-height`（中身が少なければ箱も低い。`null` なら上限なし）。
 * 変えたあとは `height`（決めた高さのまま。中身が少なくても空きができる）。
 *
 * **つまみはカードの中に直接描く（portal）。**カードの位置を測って置く作りだと、
 * 横のスクロールバーが出て箱が伸びたときなどに測り直しが漏れ、線から数px ずれて掴めなかった。
 * カードの子にして `bottom: -4px` で置けば、何が起きても常に下辺の線の上にある
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
  /** つまみを描く先。包んでいるカード。無ければ箱の下端に描く */
  const [card, setCard] = useState<HTMLElement | null>(null);
  // カードに「表の箱がある」と知らせる。カードは自分のつまみを出さず、この箱のつまみに任せる
  useRegisterCardBox();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setHeight(clampHeight(Number(saved)));
    } catch {
      // 壊れた値が入っていたら既定の高さで始める
    }
  }, [storageKey]);

  // 包んでいるカードを探す。つまみを絶対位置で置けるよう、カードを位置の基準にする
  useLayoutEffect(() => {
    const found = boxRef.current?.closest<HTMLElement>('[data-slot="card"]') ?? null;
    if (found && getComputedStyle(found).position === "static") found.style.position = "relative";
    setCard(found);
  }, []);

  const apply = useCallback(
    (px: number) => {
      const next = clampHeight(px);
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

  // つまみは共通部品。カードを閉じているあいだは出さない（閉じた札の縁を引いても中身が無い）
  const handle = (
    <EdgeHandle
      label={m.table.resizeHeight}
      current={current}
      onResize={apply}
      onReset={reset}
      className="group-data-[collapsed=true]/card:hidden"
    />
  );

  return (
    <div className="relative">
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
      {card ? createPortal(handle, card) : handle}
    </div>
  );
}
