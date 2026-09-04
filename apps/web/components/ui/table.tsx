"use client";

import * as React from "react";

import { useStickyScrollbar } from "@/components/data-table/sticky-scrollbar";
import { cn } from "@/lib/utils";

/**
 * 中身がセルの外へ出ないようにする決まり。
 *
 * 列の幅は決まっているので、長い文字はそのままだと**隣のセルの上に重なって**出る。
 * 折り返せるものは折り返し、折り返せないもの（数字や日付）は、はみ出たぶんを隠す。
 *
 * **見出しの行には掛けない。**列幅を変えるつまみが境目をまたいで置いてあり、
 * 隠すと掴めなくなる。見出しの文字は、中の入れ物のほうで切る。
 */
export const CELL_CLIP = "[&_tbody_td]:overflow-hidden [&_tfoot_td]:overflow-hidden";

/*
  行や見出しの色を、**透けない形**で作ったもの。
  貼り付ける（sticky）セルに使う。透けていると、下を流れていく列が見えてしまう。
  もとの `bg-muted/50` `bg-muted/40` と同じ色になるよう混ぜている
*/
export const OPAQUE_MUTED_50 = "bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]";
export const OPAQUE_MUTED_40 = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";
/** 見出しの行に使うとき、乗せても色が変わらないようにする */
export const OPAQUE_MUTED_50_HOVER =
  "hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]";

/*
  **貼り付ける見出しの枠線は、影で引く。**

  枠線を重ねて描く表（`border-collapse: collapse`）では、線をセルではなく
  **表そのものが描く。**見出しを貼り付けて動かすと、線だけが元の場所に残り、
  スクロール中は見出しの枠が消えてしまう。影ならセルと一緒に動く。

  `thead` に付けると上下の線、その中の `th` に付けると縦の区切りになる。
  行のいちばん右には引かない（表の外側の線になってしまう）。
*/
export const STICKY_HEAD_LINES = [
  "shadow-[inset_0_1px_0_0_var(--border),inset_0_-1px_0_0_var(--border)]",
  "[&_th:not(:last-child)]:shadow-[inset_-1px_0_0_0_var(--border)]",
].join(" ");

function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  /**
   * 表を包む枠の見た目。既定は横にだけ流す。
   * **外側で高さを決めて縦にも流したいときは、ここで `overflow-visible` にして
   * 包む枠のスクロールを止める。**入れ子にすると、見出しを上に貼り付けられない
   */
  containerClassName?: string;
}) {
  // 縦に長い表でも横に送れるよう、画面の下に貼り付く帯を付ける（はみ出していなければ出ない）
  const sticky = useStickyScrollbar<HTMLDivElement>();
  return (
    <div
      ref={sticky.attach}
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", CELL_CLIP, className)}
        {...props}
      />
      {sticky.node}
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
