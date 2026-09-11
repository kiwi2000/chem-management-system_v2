"use client";

import {
  type CSSProperties,
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
  style,
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
  /** 行の高さの変数など。高さの指定はこれに重ねる（`rowProps` の style で高さが消えたことがあった） */
  style?: CSSProperties;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children" | "style">) {
  const { m } = useI18n();
  const [height, setHeight] = useState<number | null>(null);
  /**
   * 中身が増えたときに、いったん広げた高さ（px）。
   * 表の見出しを開くなどして行が増えたら、増えたぶんが隠れないよう箱を中身に合わせて広げる
   * （2026-09-11 指示）。中身が減れば元の高さ（決めた高さ・既定）に戻る。**覚えない**
   */
  const [grown, setGrown] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /**
   * 中身を包む div。高さの変化はこれで見張る。
   * `<table>` を直接 ResizeObserver で見ても通知が来ない（ブラウザの仕様）ので、1枚かませる
   */
  const contentRef = useRef<HTMLDivElement | null>(null);
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

  // 中身の高さを見張る。増えて箱からはみ出したら箱を広げ、減ったら元に戻す
  useEffect(() => {
    const el = boxRef.current;
    const inner = contentRef.current;
    if (!el || !inner) return;
    // 最初は測るだけ（開いた直後の中身は、決めた高さの中で送ればよい）
    // 中身の高さは包んだ div で測る（箱の scrollHeight は箱より小さくならず、減ったのが分からない）
    let last = inner.offsetHeight;
    const check = () => {
      const content = inner.offsetHeight;
      const prev = last;
      last = content;
      if (content > prev && content > el.clientHeight) {
        // 枠線と横のスクロールバーのぶんを足す（height は枠線込みの値）
        setGrown(content + (el.offsetHeight - el.clientHeight));
      } else if (content < prev) {
        setGrown(null);
      }
    };
    /*
      行の増減は DOM の変化（MutationObserver）で拾う。描画が止まっている裏のタブでも届く。
      文字の折り返しなど DOM が変わらない高さの変化は ResizeObserver で拾う
    */
    const mo = new MutationObserver(check);
    mo.observe(inner, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(inner);
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, []);

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
      // 手で決めたら、自動で広げたぶんは捨てる
      setGrown(null);
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
    setGrown(null);
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
        /*
          決めた高さは**上限**として効かせる（max-height）。中身がそれより少なければ箱はそのぶん低く、
          表の下に空きができない（製品を変えて開いたら表の下が大きく空いた。2026-09-11 指示）。
          中身が増えたときに広げた高さ（grown）も同じく上限
        */
        style={{
          ...style,
          maxHeight: grown ?? height ?? defaultMaxHeight ?? undefined,
        }}
        {...rest}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {card ? createPortal(handle, card) : handle}
    </div>
  );
}
