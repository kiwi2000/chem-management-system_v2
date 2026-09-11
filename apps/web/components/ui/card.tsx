"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";

import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/*
  **見出しのあるカードは、見出しの「>」で開け閉めでき、下辺の線を引くと高さが変わる**
  （2026-09-11 指示）。
  - 開け閉めは左のメニューと同じ動き。「>」を押すと開いて「v」になり、もう一度押すと閉じる。
    閉じても中身は捨てない（`hidden` で隠すだけ）ので、入力の途中で閉じても消えない
  - 高さは、表を持つカードでは表の箱（ResizableBox）が受け持ち、それ以外のカードでは
    中身（CardContent）の高さを変えて中で送る。どちらもつまみはカードの下辺の線
  - 開け閉めも高さも端末に覚える（鍵は「画面のパス＋見出しの文字」。列幅と同じ扱い）
  見出し（CardHeader / CardTitle）の無いカードは、これまでどおり開きっぱなしで高さも変えない
*/

/** 高さの下限。見出しと数行は見えるように */
const MIN_HEIGHT = 120;
/** 画面より高くはしない（下端のつまみが画面の外へ出ると戻せない） */
const MARGIN_BELOW = 40;
/** 矢印キー1回で動く量（Shift で4倍） */
const KEY_STEP = 24;

/** 高さを、掴める範囲に収める */
export function clampHeight(px: number) {
  if (!Number.isFinite(px)) return MIN_HEIGHT;
  const max = typeof window === "undefined" ? 2000 : window.innerHeight - MARGIN_BELOW;
  return Math.min(Math.max(MIN_HEIGHT, max), Math.max(MIN_HEIGHT, Math.round(px)));
}

/**
 * 下辺のつまみ。列幅・行の高さのつまみ（resizable-columns.tsx）と同じく、線をまたいで置き、
 * 見た目には線しか無い（掴むと線が色づく）。置く親に `relative` が要る
 */
export function EdgeHandle({
  label,
  current,
  onResize,
  onReset,
  className,
}: {
  label: string;
  /** いまの高さ（px） */
  current: () => number;
  onResize: (px: number) => void;
  /** 2回押しで元に戻す */
  onReset: () => void;
  className?: string;
}) {
  const drag = React.useRef<{ startY: number; startHeight: number } | null>(null);
  /*
    **ドラッグ中はページを短くしない。**
    箱を縮めるとページが短くなる。下まで送っていたときは、ブラウザが送り位置を詰めるので
    ページごと上へずれ、線がマウスから離れていった（2026-09-11）。
    掴んだときに、縮められる最大のぶんだけ body の下に余白を足しておき、離したときに消す
  */
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.paddingBottom = "";
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={label}
      tabIndex={0}
      className={cn(
        "hover:bg-primary/40 focus-visible:bg-primary/40 absolute -bottom-1 left-0 z-10 h-2 w-full cursor-row-resize touch-none select-none outline-none",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const startHeight = current();
        drag.current = { startY: e.clientY, startHeight };
        document.body.style.paddingBottom = `${Math.max(0, startHeight - MIN_HEIGHT)}px`;
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onResize(drag.current.startHeight + (e.clientY - drag.current.startY));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = (e.shiftKey ? 4 : 1) * KEY_STEP;
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

interface CardState {
  open: boolean;
  toggle: () => void;
  /** 見出しの文字が分かったら、開け閉めを覚える鍵に使う */
  registerTitle: (text: string) => void;
  /** 表の箱（ResizableBox）が中にあることを知らせる。あればカードは自分のつまみを出さない */
  registerBox: () => () => void;
  /** 中身の要素。カードのつまみで高さを変えるときに測る */
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
  /** カードのつまみで決めた中身の高さ（px）。null なら中身なり */
  contentHeight: number | null;
}

const CardContext = React.createContext<CardState | null>(null);

/*
  画面にある枠の登録簿。上部の帯の「展開」「格納」（card-toggle-all.tsx）が、
  ここに登録してある枠をまとめて開け閉めする。数は「ボタンを出すかどうか」に使う
*/
const cardListeners = new Set<(open: boolean) => void>();
const countListeners = new Set<() => void>();
function notifyCount() {
  for (const l of countListeners) l();
}

/** 画面の枠をすべて開く／閉じる */
export function setAllCards(open: boolean) {
  for (const l of cardListeners) l(open);
}

/** 画面にある枠の数（ボタンを出すかどうかの判断用） */
export function useCardCount() {
  return React.useSyncExternalStore(
    (cb) => {
      countListeners.add(cb);
      return () => countListeners.delete(cb);
    },
    () => cardListeners.size,
    () => 0,
  );
}

/** 表の箱がカードの中にあることを、カードに知らせる（ResizableBox が呼ぶ） */
export function useRegisterCardBox() {
  const card = React.useContext(CardContext);
  const register = card?.registerBox;
  React.useEffect(() => register?.(), [register]);
  return card !== null;
}

function Card({
  className,
  size = "default",
  collapsible = true,
  defaultOpen = false,
  storageKey,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  /** 見出しの「>」で開け閉めできるか。既定はできる */
  collapsible?: boolean;
  /** 最初に開いているか。**既定は閉じる**（2026-09-11 指示。覚えている状態があればそちらが勝つ） */
  defaultOpen?: boolean;
  /** 開け閉めと高さを覚える鍵。省くと「画面のパス＋見出しの文字」 */
  storageKey?: string;
}) {
  const pathname = usePathname();
  const { m } = useI18n();
  const [open, setOpen] = React.useState(defaultOpen);
  const [titleText, setTitleText] = React.useState<string | null>(null);
  const [boxes, setBoxes] = React.useState(0);
  const [contentHeight, setContentHeight] = React.useState<number | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const key = storageKey ?? (titleText ? `chem.card.${pathname}.${titleText.slice(0, 40)}` : null);

  // 覚えている開け閉めと高さを読む（鍵が決まってから）
  React.useEffect(() => {
    if (!key) return;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === "0") setOpen(false);
      else if (saved === "1") setOpen(true);
      const h = window.localStorage.getItem(`${key}.height`);
      if (h) setContentHeight(clampHeight(Number(h)));
    } catch {
      // 読めなければ既定のまま
    }
  }, [key]);

  const remember = React.useCallback(
    (next: boolean) => {
      if (!key) return;
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // 覚えられなくても、いまの画面では効かせる
      }
    },
    [key],
  );

  const toggle = React.useCallback(() => {
    setOpen((prev) => {
      remember(!prev);
      return !prev;
    });
  }, [remember]);

  // 上部の「展開」「格納」に応じる。見出しの無い（鍵の決まらない）枠は登録しない
  React.useEffect(() => {
    if (!collapsible || !key) return;
    const listener = (next: boolean) => {
      remember(next);
      setOpen(next);
    };
    cardListeners.add(listener);
    notifyCount();
    return () => {
      cardListeners.delete(listener);
      notifyCount();
    };
  }, [collapsible, key, remember]);

  const resize = React.useCallback(
    (px: number) => {
      const next = clampHeight(px);
      if (key) {
        try {
          window.localStorage.setItem(`${key}.height`, String(next));
        } catch {
          // 覚えられなくても、いまの画面では効かせる
        }
      }
      setContentHeight(next);
    },
    [key],
  );
  const resetHeight = React.useCallback(() => {
    if (key) {
      try {
        window.localStorage.removeItem(`${key}.height`);
      } catch {
        // 消せなくても、いまの画面では戻す
      }
    }
    setContentHeight(null);
  }, [key]);

  const registerTitle = React.useCallback((text: string) => setTitleText(text), []);
  const registerBox = React.useCallback(() => {
    setBoxes((n) => n + 1);
    return () => setBoxes((n) => n - 1);
  }, []);
  const state = React.useMemo<CardState | null>(
    () =>
      collapsible
        ? {
            open,
            toggle,
            registerTitle,
            registerBox,
            contentRef,
            // 表の箱がある枠は箱が高さを持つ。枠の側で覚えていた高さは効かせない（下に空きができる）
            contentHeight: boxes === 0 ? contentHeight : null,
          }
        : null,
    [collapsible, open, toggle, registerTitle, registerBox, contentHeight, boxes],
  );

  return (
    <CardContext.Provider value={state}>
      <div
        data-slot="card"
        data-size={size}
        data-collapsed={open ? undefined : "true"}
        className={cn(
          "group/card relative flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
          className,
        )}
        {...props}
      >
        {children}
        {/*
          カード自身のつまみ。表の箱（ResizableBox）が中にあるときはそちらが同じ場所に出すので出さない。
          見出しが無い（鍵が決まらない）カードにも出さない
        */}
        {state && open && boxes === 0 && key && (
          <EdgeHandle
            label={m.table.resizeHeight}
            current={() => contentRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT}
            onResize={resize}
            onReset={resetHeight}
          />
        )}
      </div>
    </CardContext.Provider>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 見出し。開け閉めできるカードでは、先頭に「>」を置き、見出しのどこを押しても開け閉めする。
 * 見出しの文字は、開け閉めを覚える鍵になる。
 *
 * **「>」は button にしない。**読み取り専用のフォームは `<fieldset disabled>` で包んであり、
 * その中の button は押せなくなる（物質の画面で閉じられなかった）。span に役割を付けて押せるようにする
 */
function CardTitle({ className, children, ...props }: React.ComponentProps<"div">) {
  const card = React.useContext(CardContext);
  const { m } = useI18n();
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const register = card?.registerTitle;

  React.useEffect(() => {
    const text = textRef.current?.textContent?.trim();
    if (register && text) register(text);
  }, [register, children]);

  if (!card) {
    return (
      <div
        data-slot="card-title"
        className={cn(
          "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading flex min-w-0 cursor-pointer items-center gap-1 text-base leading-snug font-medium select-none group-data-[size=sm]/card:text-sm",
        className,
      )}
      onClick={card.toggle}
      {...props}
    >
      <span
        role="button"
        tabIndex={0}
        aria-expanded={card.open}
        aria-label={card.open ? m.common.close : m.common.open}
        className="hover:bg-accent focus-visible:bg-accent -ml-1 flex size-6 shrink-0 items-center justify-center rounded outline-none"
        onClick={(e) => {
          e.stopPropagation();
          card.toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            card.toggle();
          }
        }}
      >
        <ChevronRight
          className={cn("size-4 transition-transform", card.open && "rotate-90")}
          aria-hidden="true"
        />
      </span>
      <span ref={textRef} className="min-w-0 flex-1">
        {children}
      </span>
    </div>
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

/**
 * 中身。カードを閉じているあいだは隠す（捨てない）。
 * カードのつまみで高さを決めたときは、その高さで中を送る
 */
function CardContent({ className, hidden, style, ...props }: React.ComponentProps<"div">) {
  const card = React.useContext(CardContext);
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (card) card.contentRef.current = el;
    },
    [card],
  );
  const sized = card?.contentHeight ?? null;
  return (
    <div
      ref={setRef}
      data-slot="card-content"
      hidden={hidden || (card ? !card.open : false)}
      className={cn("px-(--card-spacing)", sized !== null && "overflow-y-auto", className)}
      // 決めた高さは上限。中身が少なければそのぶん低い（箱と同じ決まり）
      style={sized !== null ? { ...style, maxHeight: sized } : style}
      {...props}
    />
  );
}

function CardFooter({ className, hidden, ...props }: React.ComponentProps<"div">) {
  const card = React.useContext(CardContext);
  return (
    <div
      data-slot="card-footer"
      hidden={hidden || (card ? !card.open : false)}
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
