"use client";

import { useState } from "react";
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
}: {
  userId: string | null;
  name: string;
  size?: number;
  version?: string | number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0) || "?";
  const src = userId ? `/api/users/${userId}/avatar${version ? `?v=${version}` : ""}` : null;

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
          src={src}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="font-medium">{initial}</span>
      )}
    </span>
  );
}
