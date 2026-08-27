import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** 隣。無ければ null（端に来たら押せない見た目にする） */
export interface Neighbour {
  href: string;
  label: string;
}

/**
 * 前へ・次への矢印。
 *
 * 画面を1段1画面に分けたことで、順に見ていく道が無くなった。
 * 一覧へ戻って次の行を押す、を繰り返すのは手間なので、見出しの横に置く。
 *
 * **隣が無ければ押せない見た目にして、消さない。**
 * 消すと押す場所が左右にずれて、続けて押しているときに指が迷う。
 */
export function PrevNext({ prev, next }: { prev: Neighbour | null; next: Neighbour | null }) {
  const shape =
    "text-muted-foreground inline-flex max-w-56 items-center gap-1 text-xs hover:text-foreground";
  const dead = "text-muted-foreground/40 pointer-events-none";

  return (
    <div className="flex items-center gap-3">
      {prev ? (
        <Link href={prev.href} className={shape} title={prev.label}>
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{prev.label}</span>
        </Link>
      ) : (
        <span className={cn(shape, dead)} aria-hidden>
          <ChevronLeft className="size-4 shrink-0" />
        </span>
      )}
      {next ? (
        <Link href={next.href} className={shape} title={next.label}>
          <span className="truncate">{next.label}</span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </Link>
      ) : (
        <span className={cn(shape, dead)} aria-hidden>
          <ChevronRight className="size-4 shrink-0" />
        </span>
      )}
    </div>
  );
}
