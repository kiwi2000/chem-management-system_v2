"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";

import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/*
  **見出しのあるカードは、見出しの「>」で開け閉めできる**（2026-09-11 指示）。
  左のメニューと同じ動きで、「>」を押すと開いて「v」になり、もう一度押すと閉じる。
  閉じても中身は捨てない（`hidden` で隠すだけ）ので、入力の途中で閉じても消えない。
  開け閉めは端末に覚える（鍵は「画面のパス＋見出しの文字」。列幅と同じ扱いで URL には載せない）。
  見出し（CardHeader / CardTitle）の無いカードは、これまでどおり開きっぱなし。
*/

interface CardState {
  open: boolean;
  toggle: () => void;
  /** 見出しの文字が分かったら、開け閉めを覚える鍵に使う */
  registerTitle: (text: string) => void;
}

const CardContext = React.createContext<CardState | null>(null);

function Card({
  className,
  size = "default",
  collapsible = true,
  defaultOpen = true,
  storageKey,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  /** 見出しの「>」で開け閉めできるか。既定はできる */
  collapsible?: boolean;
  /** 最初に開いているか（覚えている状態があればそちらが勝つ） */
  defaultOpen?: boolean;
  /** 開け閉めを覚える鍵。省くと「画面のパス＋見出しの文字」 */
  storageKey?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(defaultOpen);
  const [titleText, setTitleText] = React.useState<string | null>(null);
  const key = storageKey ?? (titleText ? `chem.card.${pathname}.${titleText.slice(0, 40)}` : null);

  // 覚えている開け閉めを読む（鍵が決まってから）
  React.useEffect(() => {
    if (!key) return;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === "0") setOpen(false);
      else if (saved === "1") setOpen(true);
    } catch {
      // 読めなければ既定のまま
    }
  }, [key]);

  const toggle = React.useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (key) {
        try {
          window.localStorage.setItem(key, next ? "1" : "0");
        } catch {
          // 覚えられなくても、いまの画面では効かせる
        }
      }
      return next;
    });
  }, [key]);

  const registerTitle = React.useCallback((text: string) => setTitleText(text), []);
  const state = React.useMemo<CardState | null>(
    () => (collapsible ? { open, toggle, registerTitle } : null),
    [collapsible, open, toggle, registerTitle],
  );

  return (
    <CardContext.Provider value={state}>
      <div
        data-slot="card"
        data-size={size}
        data-collapsed={open ? undefined : "true"}
        className={cn(
          "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
          className,
        )}
        {...props}
      />
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
 * 見出しの文字は、開け閉めを覚える鍵になる
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
      <button
        type="button"
        aria-expanded={card.open}
        aria-label={card.open ? m.common.close : m.common.open}
        className="hover:bg-accent -ml-1 flex size-6 shrink-0 items-center justify-center rounded"
        onClick={(e) => {
          e.stopPropagation();
          card.toggle();
        }}
      >
        <ChevronRight
          className={cn("size-4 transition-transform", card.open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
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

/** 中身。カードを閉じているあいだは隠す（捨てない） */
function CardContent({ className, hidden, ...props }: React.ComponentProps<"div">) {
  const card = React.useContext(CardContext);
  return (
    <div
      data-slot="card-content"
      hidden={hidden || (card ? !card.open : false)}
      className={cn("px-(--card-spacing)", className)}
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
