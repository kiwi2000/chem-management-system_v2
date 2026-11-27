"use client";

import { useCallback, useRef } from "react";

/**
 * 続けて頼んだ読み込みのうち、**最後に頼んだものの結果だけを表に出す**ための印（2026-11-27）。
 *
 * 一覧は条件が変わるたびにデータを取りに行く。前の問い合わせが遅れて返ってくると、
 * 新しい条件の結果を古い条件の結果で上書きしてしまい、「欄には条件が出ているのに、表は条件なし」になる
 * （物質の一覧で、開き直して前回の条件を戻したとき。条件なしの 6 万件を数えるほうが遅く、あとから届いた）。
 *
 * 使い方: 読み込みの最初に `const isLatest = beginRequest();` とし、
 * `await` のあと（fetch と res.json() の両方）で `if (!isLatest()) return;` を通してから結果を置く。
 */
export function useLatestRequest(): () => () => boolean {
  const seq = useRef(0);
  return useCallback(() => {
    const id = ++seq.current;
    return () => id === seq.current;
  }, []);
}
