"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./types";

/**
 * 列幅。利用者がドラッグで変えた幅を端末に覚えておく。
 * フィルターと違って見た目の好みなので URL には載せない。
 */
export function useColumnWidths(storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setWidths(JSON.parse(saved) as Record<string, number>);
    } catch {
      // 壊れた値が入っていたら既定幅で始める
    }
  }, [storageKey]);

  /**
   * その列の幅。
   * 引数は `key` と `width` だけ見る。一覧の列定義でも、
   * 手書きの表が持つ簡単な組（`{ key, width }`）でも同じように渡せる。
   */
  const widthOf = useCallback(
    (col: { key: string; width?: number }) => widths[col.key] ?? col.width ?? DEFAULT_COLUMN_WIDTH,
    [widths],
  );

  /**
   * まとめて幅を変える。
   * 列幅は比率で描くので、1列を広げるときは隣を同じだけ狭めないと
   * 掴んだ場所とカーソルがずれていく。そのため2列を一度に書き換えられるようにしてある。
   */
  const setWidths2 = useCallback(
    (changes: Record<string, number>) => {
      setWidths((prev) => {
        const next = { ...prev };
        for (const [key, px] of Object.entries(changes)) {
          next[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(px));
        }
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [storageKey],
  );

  const setWidth = useCallback(
    (key: string, px: number) => setWidths2({ [key]: px }),
    [setWidths2],
  );

  const resetWidths = useCallback(() => {
    window.localStorage.removeItem(storageKey);
    setWidths({});
  }, [storageKey]);

  return {
    widthOf,
    setWidth,
    setWidths: setWidths2,
    resetWidths,
    hasCustomWidths: Object.keys(widths).length > 0,
  };
}
