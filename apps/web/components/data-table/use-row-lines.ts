"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_ROW_LINES, ROW_LINE_HEIGHT, ROW_PADDING } from "./types";

/**
 * 行の高さ。利用者がドラッグで変えた高さを端末に覚えておく。
 * 列幅と同じ扱い（見た目の好みなので URL には載せない）。
 *
 * **持つのは「px」ではなく「何行ぶんか」。**
 * 列によって字の大きさが違うので、px で持つと列ごとに切れる位置がずれる。
 * 行数で持てば、どの列も同じ行数で切れる。
 *
 * `null` は**何も指定していない状態**で、今までどおり中身なりの高さになる。
 */
export function useRowLines(storageKey: string) {
  const [lines, setLines] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setLines(clamp(Number(saved)));
    } catch {
      // 壊れた値が入っていたら中身なりの高さで始める
    }
  }, [storageKey]);

  const setRowLines = useCallback(
    (n: number) => {
      const next = clamp(n);
      window.localStorage.setItem(storageKey, String(next));
      setLines(next);
    },
    [storageKey],
  );

  const resetRowLines = useCallback(() => {
    window.localStorage.removeItem(storageKey);
    setLines(null);
  }, [storageKey]);

  return { rowLines: lines, setRowLines, resetRowLines, hasCustomRowLines: lines !== null };
}

function clamp(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ROW_LINES, Math.max(1, Math.round(n)));
}

/** 行数から、行の高さ（px）を出す */
export function rowHeightOf(lines: number) {
  return lines * ROW_LINE_HEIGHT + ROW_PADDING;
}

/** 行の高さ（px）から、いちばん近い行数を出す */
export function rowLinesOf(px: number) {
  return clamp((px - ROW_PADDING) / ROW_LINE_HEIGHT);
}
