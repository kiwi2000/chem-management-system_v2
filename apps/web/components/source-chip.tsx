"use client";

import { cn } from "@/lib/utils";

export interface SourceInfo {
  id: string;
  code: string;
  /** 決めていなければ空。色が無いときは枠だけで出す */
  color: string | null;
  /** 印に出す文字。決めていなければコードの頭文字を使う */
  mark?: string | null;
}

/**
 * 印に出す文字。
 *
 * 決めていなければコードの頭文字を使う。**頭文字はぶつかる**
 * （`CHRIP` と `CFR` はどちらも `C`）ので、ぶつかるときは
 * データソースの画面で文字を決められる。1文字とは限らない。
 *
 * どちらにしても**マウスを載せるとコードが出る**ようにし、
 * ボタンで出す札にも並びを全部書く。
 */
export const markOf = (s: { code: string; mark?: string | null }) =>
  s.mark?.trim() || (s.code.trim()[0] ?? "?").toUpperCase();

/**
 * データソースの印。表のセルの先頭と、意味を並べる札の両方で使う。
 *
 * **色は目印であって、意味を持たせない。**色が見分けにくい人にも伝わるよう、
 * 印の中には必ず頭文字を出す。
 */
export function SourceChip({ source, className }: { source: SourceInfo; className?: string }) {
  return (
    <span
      title={source.code}
      className={cn(
        /*
          **横は中身で伸ばす。**印は1文字とは限らないので、
          正方形に決め打つと2文字以上がはみ出す
        */
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] px-0.5 align-[-0.15em] text-[0.6rem] leading-none font-bold",
        // 色を決めていないときは枠だけ。何も出さないと印が消えて位置がずれる
        source.color ? "text-white" : "border-muted-foreground/50 text-muted-foreground border",
        className,
      )}
      style={source.color ? { backgroundColor: source.color } : undefined}
    >
      {markOf(source)}
    </span>
  );
}

/**
 * セルの先頭に出す印の並び。
 *
 * **並びは優先度の順**（サーバーがその順で返す）。空なら何も出さない
 */
export function SourceChips({
  ids,
  sources,
  className,
}: {
  ids: string[];
  /** そのバージョンのデータソース。ID から引くために渡す */
  sources: SourceInfo[];
  className?: string;
}) {
  const found = ids.map((id) => sources.find((s) => s.id === id)).filter((s) => s !== undefined);
  if (found.length === 0) return null;
  return (
    <span className={cn("mr-1 inline-flex gap-0.5", className)}>
      {found.map((s) => (
        <SourceChip key={s.id} source={s} />
      ))}
    </span>
  );
}

/**
 * 前のバージョンからの差分の印。
 *
 * **データソースの印のあと、法文物質名の前に置く。**
 * 「どこから来たか」を見てから「新しいかどうか」を読む順にする。
 * 赤いのは、見落とすと該非が変わっていたことに気づけないため
 */
export function DiffChip({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="bg-destructive mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] align-[-0.15em] text-[0.6rem] leading-none font-bold text-white"
    >
      差
    </span>
  );
}
