"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 利用者の顔。
 * 登録が無い人（と、画像が取れなかったとき）は頭文字の丸で代用する。
 * 誰なのかが分かればよいので、取れないこと自体は不具合として扱わない。
 */
export function UserAvatar({
  userId,
  name,
  size = 32,
  /** 画像を差し替えた直後に古い絵が残らないよう、変えるたびに違う値を渡す */
  version,
  className,
  override,
}: {
  userId: string | null;
  name: string;
  size?: number;
  version?: string | number;
  className?: string;
  /**
   * 保存前の見え方を出すための差し替え。
   * 文字列ならその絵、null なら頭文字、渡さなければ保存済みのものを出す。
   */
  override?: string | null;
}) {
  // 取れなかった絵のアドレス。絵が変われば（登録・差し替え）、もう一度読みに行く
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const initial = name.trim().charAt(0) || "?";
  const stored = userId ? `/api/users/${userId}/avatar${version ? `?v=${version}` : ""}` : null;
  const src = override === undefined ? stored : override;
  const failed = failedSrc === src;

  /*
    画面の準備が整う前に読み込みが失敗していると、onError は届かない
    （サーバーが先に描いた絵は、準備の前に読み込みが終わることがある）。
    整ったあとに、もう失敗していないかを見る
  */
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);

  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden
    >
      {src && !failed ? (
        // 画像の読み込みは next/image を通さない（DBから返す動的な絵で、最適化の対象にならない）
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // 絵が変わったら作り直す（前の絵の「失敗」を、次の絵のものと取り違えないため）
          key={src}
          ref={imgRef}
          src={src}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="font-medium">{initial}</span>
      )}
    </span>
  );
}
